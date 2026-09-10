# Study Buddy Development Batch

This is the waiting list for changes accumulating before the next release freeze. It records development work, not release acceptance.

## Current line

- Version metadata: `0.2.3-alpha`
- State: open development batch; not a frozen candidate
- Version bump, tag, final package, VM release acceptance, and publication: deferred

## Queued changes

| Change | Status | Focused evidence | Final-batch work still required |
| --- | --- | --- | --- |
| Prevent the packaged workflow-only `npm` shim from intercepting Codex provider updates | Implemented; verification in progress | Provider-maintenance regression tests cover Linux/NVM, shim-only fallback, and Windows `npm.cmd` resolution | Holistic review, exact-candidate packaging, and clean Fedora/Windows VM acceptance after the batch is frozen |

## Freeze policy

Continue adding compatible, individually tested changes and scoped commits to this line. Roughly 10–20 fixes is a useful batching target, not a hard requirement. When the owner freezes the batch, use the applicable Study Buddy review and release skills, resolve the combined findings, build exact immutable candidate bytes, and test those bytes on clean Fedora and Windows VMs before requesting publication approval.

If candidate bytes change, previous packaged acceptance no longer applies. Public tags are immutable and must never be moved or reused.
