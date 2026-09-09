# Semantic source search and obligation coverage

Broad deadline requests default to the current semester. Explicit requests for
historical courses or all historical enrollments expand the scope. A read-only
semantic resolver interprets colloquial course names using observed enrollment
metadata and inspected course evidence; unresolved scope cannot silently expand
or produce a complete negative answer.

The original date boundary is retained through planning, source acquisition and
quiz selection. Explicit shared-month date ranges retain both endpoints, actual
source years remain unchanged, and template deadlines remain visibly uncertain.

The workflow accounts for the full selected course/activity inventory, retains
source quotes and personal-status evidence, and reports acquisition gaps.
Account-isolated proof caches require source verification. Source progress is
published to the desktop parent, which must wait for the supervised terminal
result and use the canonical answer. Reconnected renderer subscriptions recover
through the existing retry path.

## Validation

- Isolated canonical source tree: 1,075 tests passed; four skipped; TypeScript passed.
- Full desktop-fork workspace suite: 3,313 tests passed; five skipped.
- Isolated changed fork paths: 54 tests passed; formatting/lint and all 13
  workspace type checks passed.
- Root release-contract tests: 13 passed; local Markdown links valid.
- Production dependency audit: no reported vulnerabilities. The all-dependency
  high-severity gate passed; two existing moderate Vitest/mocker development
  dependency advisories remain. No dependency versions changed.
- Installed desktop, Balanced: current-semester overview accounted for all
  enrolled courses with explicit scope exclusions and audited 101/101 selected
  activities without gaps. A separate colloquial mathematics request resolved
  the current course and audited 16/16 activities; an unsettled quiz date was
  retained without selecting a replacement test.
- A dropped-heartbeat desktop diagnostic verified that the final answer becomes
  visible after reconnect without manual reload.
- Explicit historical-enrollment desktop verification: the first run exposed an
  inclusion phrase incorrectly used as a course restriction. A bounded independent
  scope review now distinguishes additive inclusion from whole-request restriction;
  four actual-model scope cases and the targeted regressions pass. The corrected
  desktop run includes all 46 enrollments and 1,030 activity candidates. Its
  exhaustive completeness gate has **not passed**: some historical activity facts
  remain unresolved, including extraction validation failures. A complete
  historical overview and a performance improvement are not claimed. The
  candidate is not promoted over the previously accepted local installation.
  Final historical result: partial, seven unresolved activities, 3,108.627 seconds,
  189 model calls and 39 validation retries across separate leaf packets.
  Three assignment extractions exhausted their three-attempt limit; the other
  gaps involve external activity evidence and an embedded demonstration.
- The same corrected candidate passed fresh installed-desktop regressions:
  current semester, 8 courses and 101/101 activities in 142 seconds; colloquial
  mathematics, 1 course and 16/16 activities in 68 seconds. Both had no source gaps
  and showed the correct unsettled minitest with a usable source link.
- During the long historical run the desktop backend temporarily stopped
  responding and the UI disconnected. It recovered during diagnostic profiling
  without a restart or page reload, but reliable long-run recovery is not proven.
  The parent also shortened the canonical partial report and omitted individual
  gap details; exact canonical reproduction remains an observed limitation.

The unit-suite skip counts are reported above. Desktop acquisition reads landing
metadata and does not start, fill or finally submit quiz attempts. Source systems
may change while tests run; complete coverage requires actual source evidence,
not elapsed time, a calendar-only answer or a model's confidence.
