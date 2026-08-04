# Pre-existing project and Build Week extension

## Disclosure

Study Buddy predates OpenAI Build Week. The repository began with the `0c50801` scaffolding commit on June 3, 2026 and included a read-only Study Buddy 1.0 reference implementation. The project is therefore submitted as a pre-existing project that was meaningfully extended with Codex and GPT-5.6 during the official submission period.

The submission period opened July 13, 2026 at 9:00 AM Pacific Time, which was 18:00 CEST in Vienna.

## Conservative baseline

For an unambiguous before/after comparison, this submission uses `fe3a6fe` (`Refine Moodle Typst artifact pipeline`) as the conservative pre-hackathon baseline. Its author timestamp is July 13, 2026 at 15:13 CEST, before the submission period opened.

Although several early commits were later placed onto `master` together, this baseline intentionally excludes any work whose original author timestamp could predate the official opening. The first claimed hackathon extension is `cb7d1c3`, authored July 14, 2026 at 00:28 CEST.

Compare the baseline with the final submission:

```bash
git diff --stat fe3a6fe..HEAD
git log --reverse --format='%h %aI %s' fe3a6fe..HEAD
```

## Claimed hackathon-period commits

| Commit | Authored in Vienna | Contribution |
|---|---:|---|
| `cb7d1c3` | Jul 14, 00:28 | Updated the T3 Code Study Buddy integration |
| `0d0bd7b` | Jul 16, 14:14 | Added README, setup script, and environment documentation |
| `d09112f` | Jul 17, 13:27 | Added Codex runtime preflight and CI checks |
| `fcbee5d` | Jul 17, 16:12 | Added semantic quality review to study workflows |
| `fc6d6db` | Jul 17, 17:36 | Delegated quiz and assignment execution workflows |
| `8c027ef` | Jul 17, 23:36 | Improved Moodle sourcing and added web-layout bundling |
| `60fb850` | Jul 18, 01:52 | Improved orchestration, quiz safety, and document rendering |
| `2133d1b` | Jul 18, 03:04 | Hardened cross-platform tooling, diagnostics, and Moodle security |
| `4f47476` | Jul 18, 08:31 | Added interactive Moodle workflows and learning-focused generation |
| `2e05d10` | Jul 18, 17:33 | Expanded Moodle and web-layout artifact pipelines |
| `c2d1e39` | Jul 18, 18:47 | Migrated runs to isolated workspace data storage |
| `19ee624` | Jul 18, 19:07 | Added dashboard and chapter navigation to study guides |
| `bfebe2f` | Jul 18, 19:39 | Added fair model-call scheduling and resumable extraction recovery |
| `9e22027` | Jul 18, 20:08 | Added German and English artifact-language support |
| `d87395b` | Jul 18, 20:54 | Preserved the original prompt language across workflows |
| `c4cc82f` | Jul 19, 02:31 | Hardened security boundaries and cross-platform process handling |
| `32c873c` | Jul 19, 02:50 | Prepared the hackathon release and advanced the T3 submodule to its canonical-runtime integration |
| `05c0e6b` | Jul 19, 03:05 | Completed cross-platform runtime hardening and platform setup tooling |
| `83ecf4b` | Jul 19, 03:18 | Finalized release-readiness evidence and advanced the T3 integration |
| `e3071f9` | Jul 19, 03:27 | Corrected the clean-clone instructions for the direct T3 submodule checkout |
| `251b42a` | Jul 19, 03:34 | Made the full verification suite portable across Linux, macOS, and Windows |
| `61909d8` | Jul 19, 03:43 | Made the bundled Codex launcher portable on native Windows |
| `2a29a6f` | Jul 19, 03:49 | Stabilized the final cross-platform Typst integration test |

The release commit `2a29a6f` passed the full GitHub Actions matrix on Ubuntu, macOS, and native Windows in [run 29669267084](https://github.com/HabsaTheDog/StudyBuddy/actions/runs/29669267084). Any finishing changes made after this table must also be committed and pushed before the deadline. The exact submitted commit should be shown in the demo video and entered consistently in the repository and Devpost materials.

## Meaningful extension summary

Compared with the conservative baseline, the hackathon version adds or substantially extends:

- a reproducible install and runtime-doctor path;
- a deeper T3 local application integration;
- GPT-5.6 task-specific model and reasoning policies;
- evaluation, telemetry, quality review, and model escalation;
- interactive quiz and assignment workflows with permission boundaries;
- source orchestration across Moodle, CIS, calendar data, and linked resources;
- student-first PDF and offline interactive HTML artifacts;
- resumable extraction and fair admission for expensive model calls;
- multilingual output and original-language preservation;
- workspace-isolated artifacts, improved diagnostics, and security hardening.

## Supporting evidence

- Dated Git history is visible in the repository.
- The historical collaboration document explains how Codex and GPT-5.6 contributed.
- The demo video should show the final commit and briefly show Codex in use.

Only the work after the conservative baseline should be evaluated as the Build Week contribution.
