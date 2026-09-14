# Study Buddy Development Batch

This is the waiting list for changes accumulating before the next release freeze. It records development work, not release acceptance.

## Current line

- Version metadata: `0.2.3-alpha`
- State: open development batch; not a frozen candidate
- Version bump, tag, final package, VM release acceptance, and publication: deferred

## Queued changes

| Change | Status | Focused evidence | Final-batch work still required |
| --- | --- | --- | --- |
| Preserve actionable Windows updater failures in desktop logs and user-visible toasts | Verified and queued | 31 focused updater/UI tests passed; full fork format/lint check and all 13 workspace typechecks passed; detailed Electron causes retain HTTP/filesystem/checksum context while signed URL query values are removed | Holistic frozen-batch review, exact-candidate packaging, and clean Windows/Fedora updater acceptance |
| Keep Quick Chats and projects independently reachable with a persistent resizable sidebar split | Verified and queued | Quick Chats load in pages of 10 inside their own scroll pane; 3 focused browser tests cover pane bounds, persisted keyboard resizing, reset, and pointer dragging; all 1,164 web unit tests, full `vp check`, and all 13 typecheck packages passed | Holistic frozen-batch review and final packaged Fedora/Windows acceptance; the focused browser component test does not cover native desktop gates |
| Task-level model assignments with role inheritance, explicit search/repair policies and per-task metrics | Verified and queued | 1,117 root tests passed (4 skipped); 3 editor browser diagnostics; 9 shared profile/schema tests; server handoff/lifecycle tests; CLI metrics test; root/fork typechecks and `vp check` passed | Holistic frozen-batch review and final packaged desktop acceptance; no automatic difficulty routing or measured model-quality improvement claimed |
| Give thread and worktree naming the full voice transcript through the existing provider input | Verified and queued | All 41 focused reactor/decider tests passed; 3 new regressions failed before the fix and passed afterward for voice-only, typed-plus-voice, and multiple-note messages; verifies generated title replacement, main-agent handoff, and hidden transcripts in the read model; full `vp check` passed | The concurrent task-profile TS2835 import issue was subsequently fixed and full fork typecheck passed; holistic frozen-batch review and final release acceptance remain required; no desktop acceptance run for this source fix |
| Preserve composer spacing when switching between Quick Chats and projects | Verified and queued | 7 focused browser-diagnostic UI tests passed, including round-trip position checks for new/existing Quick Chats at desktop/mobile widths; reproduced the previous 40/44 px jump; scoped `vp check` and full `vp run typecheck` passed | Full `vp check` reported formatting issues in 4 unrelated concurrently edited files; holistic frozen-batch review and final release acceptance remain required |
| Hide the checkout and branch toolbar in Quick Chats while preserving it in project chats | Verified and queued | 7 focused browser-diagnostic UI tests passed (new/existing Quick Chats and project chats at desktop/mobile widths); 4 Quick Chat regressions failed before the fix; `vp check` and `vp run typecheck` passed | Holistic frozen-batch review and final release acceptance; browser diagnostics do not cover native desktop gates |
| Prevent the packaged workflow-only `npm` shim from intercepting Codex provider updates | Verified and queued | Exact-commit packaged UI updated an isolated Codex fixture from `0.153.0` to `0.154.0`; provider, Windows/Linux resolution, packaged-runtime, typecheck, and artifact-contract tests passed | Holistic review, final exact-candidate packaging, and clean Fedora/Windows VM acceptance after the batch is frozen |
| Agent-composed weekly answers from native source handoffs; preserve conflicting quiz dates/status and whole-turn duration | Verified and queued; local desktop weekly-answer acceptance passed | Native handoff/classification tests; complete root suite; frontend lifecycle and server projection regressions; native conflict excerpts and learner-facing progress guidance | Holistic frozen-batch review and required final release acceptance |
| Preserve separately quoted course metadata fields during semantic source validation | Verified and queued; 35 focused tests, typecheck and local desktop run passed | Desktop run exposed valid fields rejected solely for non-adjacent ordering; separate native excerpts retain provenance | Frozen-batch review and final release acceptance |

## Freeze policy

Continue adding compatible, individually tested changes and scoped commits to this line. Roughly 10–20 fixes is a useful batching target, not a hard requirement. When the owner freezes the batch, use the applicable Study Buddy review and release skills, resolve the combined findings, build exact immutable candidate bytes, and test those bytes on clean Fedora and Windows VMs before requesting publication approval.

If candidate bytes change, previous packaged acceptance no longer applies. Public tags are immutable and must never be moved or reused.
