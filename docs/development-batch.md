# Study Buddy Development Batch

This is the waiting list for changes accumulating before the next release freeze. It records development work, not release acceptance.

## Current line

- Version metadata: `0.2.3-alpha`
- State: open development batch; not a frozen candidate
- Version bump, tag, final package, VM release acceptance, and publication: deferred

## Queued changes

| Change | Status | Focused evidence | Final-batch work still required |
| --- | --- | --- | --- |
| Hide the checkout and branch toolbar in Quick Chats while preserving it in project chats | Verified and queued | 7 focused browser-diagnostic UI tests passed (new/existing Quick Chats and project chats at desktop/mobile widths); 4 Quick Chat regressions failed before the fix; `vp check` and `vp run typecheck` passed | Holistic frozen-batch review and final release acceptance; browser diagnostics do not cover native desktop gates |
| Prevent the packaged workflow-only `npm` shim from intercepting Codex provider updates | Verified and queued | Exact-commit packaged UI updated an isolated Codex fixture from `0.153.0` to `0.154.0`; provider, Windows/Linux resolution, packaged-runtime, typecheck, and artifact-contract tests passed | Holistic review, final exact-candidate packaging, and clean Fedora/Windows VM acceptance after the batch is frozen |
| Agent-composed weekly answers from native source handoffs; preserve conflicting quiz dates/status and whole-turn duration | Verified and queued; local desktop weekly-answer acceptance passed | Native handoff/classification tests; complete root suite; frontend lifecycle and server projection regressions; native conflict excerpts and learner-facing progress guidance | Holistic frozen-batch review and required final release acceptance |
| Preserve separately quoted course metadata fields during semantic source validation | Verified and queued; 35 focused tests, typecheck and local desktop run passed | Desktop run exposed valid fields rejected solely for non-adjacent ordering; separate native excerpts retain provenance | Frozen-batch review and final release acceptance |

## Freeze policy

Continue adding compatible, individually tested changes and scoped commits to this line. Roughly 10–20 fixes is a useful batching target, not a hard requirement. When the owner freezes the batch, use the applicable Study Buddy review and release skills, resolve the combined findings, build exact immutable candidate bytes, and test those bytes on clean Fedora and Windows VMs before requesting publication approval.

If candidate bytes change, previous packaged acceptance no longer applies. Public tags are immutable and must never be moved or reused.
