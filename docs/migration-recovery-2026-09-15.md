# Migrated desktop recovery — 2026-09-15

The reported thread `ed25ec99-1170-4a6c-bffd-968d9625a9a7` (Find Tomorrow’s
Tasks) failed before source access with `Unsupported packaged Study Buddy script:
moodle:agent`. Read-only inspection found it in the still-running old desktop
instance, after the state copy used by the active umbrella migration.

Two separate defects were confirmed:

1. Root commit `3d1008d` replaced the workflow package manifest with generated
   desktop package metadata. The existing workflow lockfile still described
   `study-buddy@0.2.3-alpha`; the replacement removed the tsx entry points used by
   the official desktop adapter and shell wrapper. The previous architecture
   implementation preserved this mismatch and did not run the desktop workflow.
2. Copied pnpm executable shims embedded absolute `NODE_PATH` entries into the old
   workspace. Both launcher trees were active; the old desktop remained the
   usable window while the new tree inherited stale dependency resolution.

The fix restores the workflow manifest from its tracked predecessor, matching
its existing lockfile and source entry points. It does not change desktop package
identity in `t3code-fork/apps/desktop`. A new package contract regression reproduces
the defect and is included in `npm run verify`.

Generated dependencies were repaired only inside active `App/t3code-fork` with:

```sh
pnpm install --offline --frozen-lockfile --ignore-scripts
```

This regenerated the copied shims without changing the lockfile. No old absolute
dependency symlinks remained afterward. The observed stale Study Buddy launcher
and backend processes were stopped; independent T3 Code was not touched. The old
source/state copies were not edited or synchronized. The later failed thread is
retained there; its relevant redacted diagnostic was saved in the active campaign.

For future moves, do not treat copied `node_modules` or build caches as portable.
Regenerate dependencies using the owning manifest/lockfile, rebuild the desktop,
and inspect native process paths and state ownership before accepting cutover.
The umbrella run script must enter `App/t3code-fork`; no old absolute launcher
path is introduced by this fix.

## Completed development acceptance

Campaign and logs: `study-buddy-data/optimization-campaigns/migration-recovery*`.
The lab is registered in umbrella `project.json`. The user explicitly authorized
fixes and real desktop prompts until restored, so no additional approval pause
was introduced.

- The package contract fails on the broken manifest and passes after restoration.
- Root typecheck passed. Full final suite: 146 files, 1,150 passed, four skipped.
  An initial run concurrent with desktop rebuild/typechecks had two timeout
  failures; both passed in focused recheck and the full four-worker rerun passed.
- Fork format/lint and all 13 typechecks passed on the existing combined working
  tree. Unrelated dirty source edits were preserved.
- Live surface: actual migrated `Study Buddy (Dev)` Electron window, attached
  through CDP with the native desktop bridge, new component and dedicated state.
- Fresh Balanced task thread: `0f3e7306-9c3d-4134-9806-00d487fc86fe`.
  It completed in 451 seconds with three classes and two verified deadlines.
  The official Moodle inventory reports 46 courses, 104 activities and zero gaps.
- Fresh Balanced artifact thread: `f40cca7d-1f83-4bc5-97e1-f87e3c0a8519`.
  It completed in 567 seconds. The first HTML had mobile horizontal overflow;
  one internal repair fixed it before responsive validation and independent
  semantic review passed. The canonical 709,550-byte file matches the delivered
  copy byte-for-byte and opened through the actual Electron workspace viewer.
  Five answers (60, 75, 92, 220, 36), incorrect-answer feedback, reveal, progress
  and reset passed in the viewer with networking temporarily offline and then
  restored. No external script/image/stylesheet assets were present.
- Both app threads are terminal `ready` with no active turn or error. No test
  workflow remains running. The repaired migrated desktop is left open.
- Package and release-contract tests: 14 passed. Workspace layout check passed.

| Live lane | Workflow calls | Known input / cached input | Known output | Recovery |
| --- | ---: | ---: | ---: | --- |
| Calendar and Moodle tasks | 14 | 196,395 / 8,960 | 9,852 | One transport fallback and one semantic retry |
| Offline worksheet | 4 | 1,043,375 / 945,536 | 16,207 | One dedicated HTML repair |

These workflow token totals exclude coordinator/probe costs; the task lane has
one dispatch with unknown usage. Separate native cumulative counters and full
thread durations are retained in campaign evidence. No complete cost or speed
improvement is claimed. The testing skill's composite-workflow reporter labels
standalone source/page runs `unknown`; official terminal summaries, native thread
state, source records and publication/interaction checks were used directly for
the campaign's manual acceptance gates. An unused browser diagnostic could not
load a file URL due to its CLI restriction and was closed; it supplies no acceptance
evidence. The interaction checks above ran in the actual desktop preview.

The campaign evaluated `accept` and is completed. App source changes are committed
locally in the recovery commit. No UI source edits were added by this repair;
previous dirty UI work remains outside that commit. The umbrella lab registration
is filesystem metadata in `project.json`, outside the coordinated Git repositories.

These are development checks, not exact packaged Windows/Fedora acceptance.
No push, release tag, publication or installer promotion is part of this repair.
