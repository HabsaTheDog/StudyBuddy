# Long-Running Agent Lease Protocol

Use this protocol for PDF generation, browser automation, downloads, builds, and
other delegated work that can legitimately take several minutes.

## Parent Contract

1. Assign one worker ownership of the task and its output directory.
2. Give the worker a five-minute checkpoint deadline.
3. Wait once for up to five minutes and thirty seconds. The extra thirty
   seconds is delivery grace, not additional worker execution time. Do not poll every few seconds and do not
   reproduce the worker's task locally while the lease is active.
4. Accept one of three checkpoint reports:
   - `completed`: validate the requested artifacts and finish.
   - `progress`: renew the same worker's lease unless it is demonstrably off-topic.
   - `blocked`: resolve the blocker, redirect the same worker, or cancel it.
5. Start a replacement worker only after the original worker and its process
   group are confirmed stopped.

For Codex subagents, use one `wait_agent` call with `timeout_ms: 330000`. A
worker that cannot finish within its lease should end that turn with a
checkpoint; continue it with `send_input` instead of spawning a duplicate.

For a local PTY process, use one empty `write_stdin` call with
`yield_time_ms: 210000`, or use the Study Buddy wrapper's `wait` command with a
210-second timeout. This preserves time for the worker to inspect the result
and formulate its checkpoint. A
blocked tool wait does not require repeated model reasoning.

## Timing Budget

Use these defaults:

- **0:00-3:30:** uninterrupted tool and implementation work;
- **3:30:** stop starting blocking operations that could outlive the lease;
- **3:30-5:00:** reserve ninety seconds to regain control, inspect state, and
  return `completed`, `progress`, or `blocked`;
- **5:00:** worker checkpoint deadline;
- **5:30:** parent wait timeout, including thirty seconds of scheduling and
  message-delivery grace.

The worker should answer immediately when work finishes. The ninety-second
reserve is a maximum response budget, not a reason to delay. Any single tool
wait started during the work window must be bounded by the remaining work
budget. Long external processes should run in a reusable session or detached
process so the worker can regain control at 3:30 without canceling them.

## Worker Contract

The worker owns the task until it reports `completed`, `blocked`, or is
explicitly canceled. It must:

- keep the approved toolchain and output directory;
- report immediately when finished instead of waiting for lease expiry;
- stop blocking tool waits after three minutes and thirty seconds;
- return a checkpoint no later than five minutes after assignment or renewal;
- distinguish process liveness from meaningful progress;
- preserve resumable artifacts before reporting a blocker;
- avoid starting an alternate implementation merely because a model call,
  browser action, or renderer is taking several minutes.

Each checkpoint should contain:

```json
{
  "report": "progress",
  "phase": "formatter",
  "current_action": "Generating standardized Typst",
  "completed_actions": ["source collection", "analysis"],
  "requested_topic": "DC-DC Wandler",
  "active_sources": ["https://moodle.example/resource"],
  "heartbeat_at": "2026-06-08T12:00:00Z",
  "semantic_progress_at": "2026-06-08T11:58:30Z",
  "next_action": "Validate and compile PDF",
  "blocker": null,
  "artifacts": [],
  "retry_count": 0
}
```

## Parent Decision Rules

Continue by default when all of the following are true:

- the worker or process is alive;
- the source and requested topic still match;
- semantic progress occurred within the phase deadline;
- the next action remains part of the approved workflow.

Redirect or cancel only with concrete evidence:

- wrong course, source, topic, or output location;
- prohibited action;
- repeated identical failure without a changed repair attempt;
- missed checkpoint and stale semantic progress;
- terminal validation failure.

A heartbeat alone is not semantic progress. Model-heavy analyzer and formatter
phases may remain silent for five minutes, so their idle deadline must exceed
the lease interval.

## Study Buddy Document Boundary

Study Buddy artifact requests use two separate workers:

1. `extract` owns Moodle/CIS access, downloads, source validation, and
   `extracted-data.json`.
2. `render` owns the standardized Typst document and PDF and consumes only a
   successful extraction run.

The orchestrator must not collapse these phases into an ad hoc implementation.
It may not write a replacement `.typ` file, invoke `typst compile` directly, or
store a Moodle-derived artifact outside the workflow directory. If rendering
fails, retry the official `render` worker against the same successful
extraction handoff. A new extraction is allowed only when the source handoff is
wrong or incomplete.
