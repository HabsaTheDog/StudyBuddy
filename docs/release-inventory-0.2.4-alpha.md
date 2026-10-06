# Study Buddy 0.2.4-alpha release inventory and contract

This records preparation scope and evidence, not release acceptance. Final decision: **BLOCKED pending exact source/artifacts, candidate-specific VM restore approval and installed acceptance**. The owner explicitly requested creating a release and uploading it directly to the website; publication/deployment is authorized in that scope and remains gated on a recorded GO for the exact bytes. VM snapshot restore approval remains candidate-specific and pending.

Version: `0.2.4-alpha`, GitHub prerelease, Windows 11 x64 and Fedora x64; intentionally unsigned Windows with warning/checksums. macOS is unsupported. Website stable download eligibility is a separate fail-closed promotion using matching `distribution-ready.json`, `release-manifest.json` and `SHA256SUMS`.

## Exact source and historical baseline

- Latest public `v0.2.2-alpha`: root `77b8730a4b1166fdccad3fa4942a11c2930f0445`, UI `6b6d811264cd896fc2abac48810edf9abac81246`; owner-testing prerelease, unpromoted and without full clean packaged acceptance.
- Selected advertised root `24f3c8c4b6eb18f38d3ff21efcd3160f61d6facc` plus local pairing `b53e2b6`; selected advertised UI `0aae142c9b3948735ba8dd7a40e37f9b2aa264de` plus local pairing `c0bd23bf9`. Parent owns isolated integration and final default-branch target.
- Default root base `39bcc2baada893a65a692e2569657d1cc5d89e07`. Preserve existing `v0.2.3-alpha` tag at historical candidate `0b039abc16b5feb084c8f8c23ac1edfb9f10755d`; do not move/reuse it.
- Root/UI canonical worktrees were clean at intake. Remote PR #53 includes all current native PDF/quiz/email/profile work and October6 security/integration fixes; local pairing is the only additional current feature delta. PR #48 is subsumed by #53.
- Root dependency PRs #36/#41/#51/#52 merged; UI #23 merged as `8a91a450d`, #22 closed as equivalent. Selected UI integration/tests are advertised separately; default UI branch need not be mistaken for the selected pin.
- PR #53 at intake: Windows/Ubuntu/policy/CodeQL/Gitleaks pass; pinned UI still running. Source CI is not installed acceptance. Final package must be built from the reviewed protected-default commit.

## Final security dependency integration

Reviewed UI `8e3d0f7e48f2187adf3d106aa662dd5aed9e10e1` adds DOMPurify3.4.16, Hono4.13.7 and
ip-address10.7.1 over the merged pairing/dependency source. Seven shipped alerts
are patched; source production audit has0 advisories across474dependencies.
Build-only sprintf-js alert245 lacks an upstream patch and is explicitly
deferred, subject to final shipped SBOM absence verification. Exact-head CI
and final packaged acceptance still gate this pin. Full dispositions are in
canonical ignored `security-alert-dispositions.json` preparation evidence.

## Included scope and full backlog mapping

Every existing table row is included as implementation. Historical “fresh native round pending” text is retained evidence, superseded only by named later results; it does not become a new success claim. The machine-readable inventory preserves each row’s status, evidence, remaining-work text and commit references. Links below identify the original backlog row; grouped scope is not an omission.

| ID | Group | Included change |
| --- | --- | --- |
| [B01](development-batch.md#queued-changes) (line 226) | quiz | Recover the exact existing first quiz attempt and preserve approval ordering |
| [B02](development-batch.md#queued-changes) (line 227) | quiz | Collect and verify the complete agent-owned quiz with original media |
| [B03](development-batch.md#queued-changes) (line 228) | quiz | Preserve first-attempt identity across the actual start redirect |
| [B04](development-batch.md#queued-changes) (line 229) | quiz | Deliver current native Codex instructions into model-visible history |
| [B05](development-batch.md#queued-changes) (line 230) | quiz | Agent-owned mini-test tools with durable first-attempt protection |
| [B06](development-batch.md#queued-changes) (line 231) | pdf | Preserve native PDF attachments in their owning workspace |
| [B07](development-batch.md#queued-changes) (line 232) | pdf | One native agent directly authors and compiles PDFs |
| [B08](development-batch.md#queued-changes) (line 233) | pdf | Render verified PDF handoffs without generative re-authoring |
| [B09](development-batch.md#queued-changes) (line 234) | sources | Preserve assessed source scope on planner failure and compact complete planning JSON |
| [B10](development-batch.md#queued-changes) (line 235) | sources | Size complete content review from actual work while preserving explicit deadlines |
| [B11](development-batch.md#queued-changes) (line 236) | sources | Scope complete review metadata and preserve exact original-source cohorts |
| [B12](development-batch.md#queued-changes) (line 237) | sources | Reuse existing review-packet space for complete atoms without new image bindings |
| [B13](development-batch.md#queued-changes) (line 238) | sources | Review every included learning claim in bounded existing-node packets |
| [B14](development-batch.md#queued-changes) (line 239) | sources | Keep zero/shortcut derivative conditions locally explicit |
| [B15](development-batch.md#queued-changes) (line 240) | sources | Independently audit physical/causal interpretation in the existing content review |
| [B16](development-batch.md#queued-changes) (line 241) | sources | Catch accidental heading/divider-only PDF pages in the existing render review |
| [B17](development-batch.md#queued-changes) (line 242) | sources | Hand explicit assigned originals across empty-download planning responses |
| [B18](development-batch.md#queued-changes) (line 243) | sources | Align mathematical interpretation with directions/frames and require conditions for unique results |
| [B19](development-batch.md#queued-changes) (line 244) | sources | Preserve prior exact acquisition intent as bounded acquired exploration |
| [B20](development-batch.md#queued-changes) (line 245) | sources | Preserve acquired exploratory sources through existing acquisition and semantic reassessment |
| [B21](development-batch.md#queued-changes) (line 246) | sources | Separate acquired source reading debt from additional downloads without losing scoped evidence |
| [B22](development-batch.md#queued-changes) (line 247) | sources | Preserve assigned single-module evidence and compare source compositions in the existing content review |
| [B23](development-batch.md#queued-changes) (line 248) | sources | Normalize unambiguous bare vector styling without altering strings or unknown expressions |
| [B24](development-batch.md#queued-changes) (line 249) | sources | Avoid duplicate PDF fallback content when learning modules share source citations |
| [B25](development-batch.md#queued-changes) (line 250) | sources | Budget complete analyzer producer payloads including packed fragments and schemas |
| [B26](development-batch.md#queued-changes) (line 251) | sources | Preserve complete PDF page composition when selecting source visuals |
| [B27](development-batch.md#queued-changes) (line 252) | sources | Preserve generated task assumptions and instantaneous-value/derivative distinctions |
| [B28](development-batch.md#queued-changes) (line 253) | sources | Preserve selected assessment evidence within bounded request evaluation and stable caching |
| [B29](development-batch.md#queued-changes) (line 254) | sources | Preserve request-level assessment source evidence across chapter, repair and PDF handoffs |
| [B30](development-batch.md#queued-changes) (line 255) | sources | Preserve concrete content defects as blocking independently of optional requirement priority |
| [B31](development-batch.md#queued-changes) (line 256) | sources | Validate mathematical conditions and Typst table row shapes before publication |
| [B32](development-batch.md#queued-changes) (line 257) | sources | Preserve chapter-warning ownership and repair global semantic findings through cache, fragments and resume |
| [B33](development-batch.md#queued-changes) (line 258) | sources | Keep PDF exercise scoring source-backed and identify generated practice locally |
| [B34](development-batch.md#queued-changes) (line 259) | sources | Select uniquely named courses without legacy alias gating and preserve exclusions through semantic recovery |
| [B35](development-batch.md#queued-changes) (line 260) | sources | Preserve citable source protocols and the evaluated assessment scope in preparation guides |
| [B36](development-batch.md#queued-changes) (line 261) | runtime | Preserve app-broker credentials routing, owning-thread worker profiles and configured Codex runtime |
| [B37](development-batch.md#queued-changes) (line 262) | ui | Shorten composer labels to profile name, Computer, Email and Quizzes; show selected permissions through icons |
| [B38](development-batch.md#queued-changes) (line 263) | ui | Make provider tabs compact and usable in existing conversations |
| [B39](development-batch.md#queued-changes) (line 264) | ui | Move composer provider switching into profile-picker icon tabs and refresh price-informed built-ins |
| [B40](development-batch.md#queued-changes) (line 265) | sources | Preserve intent-scoped weekly obligations and completed/upcoming mini-test sequences with a compact review index and native activity pages |
| [B41](development-batch.md#queued-changes) (line 266) | providers | Provider-specific Fast/Balanced/Quality, per-connection defaults, one composer profile picker and mixed custom worker/fallback connections |
| [B42](development-batch.md#queued-changes) (line 267) | pdf | Recover first-try Moodle PDF delivery in Quick Chat: provider-catalog model selection, brokered source workflow, terminal wait, complete source/task coverage, and validated deterministic rendering for large exercise sets |
| [B43](development-batch.md#queued-changes) (line 268) | builder | Preserve original requests and image evidence across provider workers; retain Codex Quick Chat workspace and cancel orphaned HTML runs |
| [B44](development-batch.md#queued-changes) (line 269) | builder | Use bounded HTML edits for every provider, preserve requested label language and forward CLI cancellation; recover Balanced builder failures with Terra |
| [B45](development-batch.md#queued-changes) (line 270) | builder | Recover interrupted provider turns, enable local worksheet form checks, preserve Codex worker account and isolate HTML builders |
| [B46](development-batch.md#queued-changes) (line 271) | providers | Preserve Gemini connections/profile choices after restart or model changes; shorten runtime temp paths; harden Claude worker errors |
| [B47](development-batch.md#queued-changes) (line 272) | providers | Simplify AI connections and remove duplicated provider/model rows |
| [B48](development-batch.md#queued-changes) (line 273) | providers | Add Codex, Claude and Gemini install/connect, optional setup, native model selection and provider-independent workers |
| [B49](development-batch.md#queued-changes) (line 274) | quiz | Repair single-page quiz navigation, navigation readiness and question-flag contamination; expose actual unresolved-answer reasons |
| [B50](development-batch.md#queued-changes) (line 275) | quiz | Simplify quiz execution into capture, parallel solving and verified filling; isolate multiple quizzes |
| [B51](development-batch.md#queued-changes) (line 276) | runtime | Restore workflow package after desktop metadata replacement and repair relocated development launchers |
| [B52](development-batch.md#queued-changes) (line 277) | builder | Complete bounded hybrid authoring, durable recovery and honest whole-turn accounting |
| [B53](development-batch.md#queued-changes) (line 278) | builder | Remove unused standard-guide AI layout planning and persist bounded item-repair recovery |
| [B54](development-batch.md#queued-changes) (line 279) | builder | Correct task execution, preflight and quiz/assessment attempt semantics |
| [B55](development-batch.md#queued-changes) (line 280) | telemetry | Route content-free PostHog and Study Buddy alerts through existing Server Admin Alerts bot |
| [B56](development-batch.md#queued-changes) (line 281) | telemetry | Harden PostHog error visibility, consent boundaries and delivery across desktop, provider setup/updates and website |
| [B57](development-batch.md#queued-changes) (line 282) | desktop | Isolate Study Buddy from T3 Code's desktop port namespace |
| [B58](development-batch.md#queued-changes) (line 283) | desktop | Surface the sanitized reason from failed Codex setup processes |
| [B59](development-batch.md#queued-changes) (line 284) | desktop | Reject foreign T3 Code renderers during packaged desktop startup |
| [B60](development-batch.md#queued-changes) (line 285) | desktop | Preserve actionable Windows updater failures in desktop logs and user-visible toasts |
| [B61](development-batch.md#queued-changes) (line 286) | ui | Keep Quick Chats and projects independently reachable with a persistent resizable sidebar split |
| [B62](development-batch.md#queued-changes) (line 287) | providers | Task-level model assignments with role inheritance, explicit search/repair policies and per-task metrics |
| [B63](development-batch.md#queued-changes) (line 288) | ui | Reliably name voice-first threads from the full transcript |
| [B64](development-batch.md#queued-changes) (line 289) | ui | Preserve composer spacing when switching between Quick Chats and projects |
| [B65](development-batch.md#queued-changes) (line 290) | ui | Hide the checkout and branch toolbar in Quick Chats while preserving it in project chats |
| [B66](development-batch.md#queued-changes) (line 291) | desktop | Prevent the packaged workflow-only `npm` shim from intercepting Codex provider updates |
| [B67](development-batch.md#queued-changes) (line 292) | sources | Agent-composed weekly answers from native source handoffs; preserve conflicting quiz dates/status and whole-turn duration |
| [B68](development-batch.md#queued-changes) (line 293) | sources | Preserve separately quoted course metadata fields during semantic source validation |

Recent prose entries additionally include loopback pairing; latest-unread reliability and initial failed audit; direct native mail context; graded-answer risk and corrected Q5 advice; source-grounded communication; real first-attempt preservation and full-media fixture acceptance. See [development batch](development-batch.md) and [agent handoff](release-agent-handoff.md).

Additional discovered scope from [PR integration](pr-integration-2026-10-06.md): published-history reconciliation; Codex SDK/CLI 0.153.4; root dependency/workflow upgrades; Electron and native cache privacy/dependency patches; real broker CI provisioning; Windows aliases/operation-lease release and portable tools/fixtures; physical PDF fallback pages; voice/instruction test corrections; CRLF catalogue parity; bounded Windows source-test concurrency. All are included.

## Evidence boundaries and explicit deferrals

- Original Custom Balanced/Terra-medium native PDF campaign remains rejected; Quality Native38/39 acceptance does not transfer.
- Quiz accepted real recovery preserves previously reviewed answers; no empty solve or official-grade acceptance. Retain five rejected native rounds and separate root rescue.
- Official lost-point quiz culprit remains unproved; user controlled comparison supersedes prior Q5 False advice.
- Preexisting external DOM edit during quiz media await is deferred outside nonconcurrent acceptance; no newly proven permission bypass.
- Equivalent-input live Study Builder quality/performance comparison remains unmeasured; deterministic 8-versus-5-call example is not live benchmark.
- Claude live-subscription acceptance is unavailable; do not claim live Claude account acceptance from adapter tests.
- Email cross-process registry coordination and other live providers remain unproved; nine unread-state receipts cover the recorded provider only.
- Global study-buddy-ui skill installation/archive is local-only outside Git; shipped helper and workflow documentation must stand independently.
- Original T3 pairing preview disconnected; separate normal-browser exchange passed, desktop/package evidence still pending.
- Historical GitHub Support cleanup confirmation is external maintainer follow-up and must not be represented as received.
- Legacy file-viewer worktree has uncommitted projectFilesQueryState.ts/test and projectCommands.ts plus generated artifacts; explicitly excluded and preserved.
- Legacy stable-rc root has only changed submodule pointer; excluded/preserved. Grounded-email worktree untracked node_modules is excluded; source already integrated.
- Old release/0.2.3-alpha branch 4579de5 and missing /tmp resume worktree are historical; no new package from them.
- macOS unsupported. No unrelated upstream UI branches or private infrastructure repository publication. Monitoring receipt is complete, not a release blocker.

Recorded development acceptance: Quality Native38/39 PDF 4/4 on all eight pages; real first-attempt recovery saved/reloaded ten preserved answers; two synthetic full-quiz native passes; grounded drafts three unchanged Balanced 4/4; direct mail six passing Electron cases; latest-unread three unchanged 4/4 with nine unread-preservation proofs. Original rejected PDF/quiz/mail evidence remains intact. All still require release-specific packaged evidence.

## Branch dispositions

All local branch tips were inventoried; exact lists/unique commits and remote-tracking branch dispositions are in the ignored machine-readable inventory. Ancestry inclusion is distinct from squash-equivalent historical behavior. Historical alternates stay preserved and are not blindly merged.

| Repository | Local branch | Tip | Disposition |
| --- | --- | --- | --- |
| root | `audit/pdf-reliability-rollback` | `d4d2d67c52bd` | included through selected integration ancestry; no extra commits |
| root | `backup/pre-0.2.2-integration-20260829` | `693935ee248b` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `backup/pre-dev-source-broker-repair-20260903` | `7a6b158435ed` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `backup/pre-final-oss-20260816` | `f2a66f032018` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `chore/pin-final-ui` | `628dd1a52318` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `codex/grounded-study-email-context` | `9cc7625057f6` | included through selected integration ancestry; no extra commits |
| root | `feat/provider-support` | `b53e2b6fcc31` | included; pairing delta must be integrated with reviewed remote tip |
| root | `fix/alpha-linux-imagemagick` | `fedb4cad4e29` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `fix/alpha-windows-linux-artifacts` | `b3b6bf895e9a` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `fix/dev-source-broker-v0.2.3` | `5fbf4867feb0` | included through selected integration ancestry; no extra commits |
| root | `fix/pin-node22-cli-execution` | `db56de93c4ab` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `fix/semantic-deadline-inventory` | `e2285fa13897` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `fix/stable-rc-review` | `020390eb5c23` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `master` | `9df6be55fcc6` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `perf/startup-latency-lab` | `ecde9e9d4008` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `release/0.2.2-alpha` | `7a6b158435ed` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `release/0.2.3-alpha` | `4579de5a0b71` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `release/0.2.4-alpha` | `24f3c8c4b6eb` | included; current parent-owned isolated integration |
| root | `release/alpha2` | `c726304282f0` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `release/consolidated-0.2.2-alpha` | `9ddf357bcdb3` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `release/final-oss-root` | `7a82953b46a5` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `release/stable-rc` | `7ee04735e0ba` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `release/unsigned-alpha` | `bbde18c9626c` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `test/source-runtime-candidate` | `7e0a3b6eb557` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| root | `test/source-runtime-candidate-v2` | `863f72b56f8a` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `agent/favorite-thread-markers` | `1dd131a36680` | deferred; divergent historical experiment/WIP, no reviewed release handoff |
| ui | `agent/finish-alpha-ui` | `b749803edc1d` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `agent/public-submodule-cleanup` | `030a1ddda916` | included through selected integration ancestry; no extra commits |
| ui | `agent/study-buddy-t3-integration` | `537272933c35` | included through selected integration ancestry; no extra commits |
| ui | `backup/pre-0.2.2-integration-20260829` | `c79ae949d996` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `backup/pre-dev-source-broker-repair-20260903` | `9dd2e5a97104` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `backup/pre-final-oss-20260816` | `230539a484e3` | included through selected integration ancestry; no extra commits |
| ui | `broken/study-buddy-app-wip-2026-08-10` | `58078a627b3f` | included through selected integration ancestry; no extra commits |
| ui | `checkpoint/stable-rc-ui-premerge-20260825` | `72b9bffc7f13` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `chore/dependabot-scope` | `1e8190ccc8d9` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `chore/gitleaks-node24` | `4401a8c1fd4c` | included through selected integration ancestry; no extra commits |
| ui | `cleanup/local-ui-integration` | `c1e0ecb65c94` | included through selected integration ancestry; no extra commits |
| ui | `codex/grounded-study-email-context` | `ccd90d6fab2b` | included through selected integration ancestry; no extra commits |
| ui | `feat/study-buddy-provider-support` | `c0bd23bf90c6` | included; pairing delta must be integrated with reviewed remote tip |
| ui | `feature/source-email-integration-oss` | `2e4967eaff71` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `fix/dev-source-broker-v0.2.3` | `b2eecc505b5d` | included through selected integration ancestry; no extra commits |
| ui | `fix/file-viewer-refresh` | `2fab18e289bd` | deferred; divergent historical experiment/WIP, no reviewed release handoff |
| ui | `fix/node-22-artifact-cli` | `d970df822f41` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `fix/node-22-cli-main-detection` | `d31c716cd2e5` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `fix/packaged-source-runtime` | `6ea54ea0399b` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `fix/restore-packaged-source-broker` | `9dd2e5a97104` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `fix/semantic-deadline-inventory` | `382f4f1b3394` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `fix/sources-alpha2` | `84192e5fee85` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `fix/stable-wrapper-contracts` | `289b40ea6040` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `main` | `602148f8fe4b` | included through selected integration ancestry; no extra commits |
| ui | `oss/remove-unused-marketing` | `2e32e82ec286` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `release/0.2.4-alpha` | `0aae142c9b39` | included; current parent-owned isolated integration |
| ui | `release/consolidated-0.2.2-alpha` | `38811265cb0d` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `release/desktop-runtime-hardening` | `9fc47523b110` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `release/final-oss-ui` | `6d6924954a4a` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `release/open-source-hardening-2026-08-11` | `d0169a5ce208` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `release/open-source-hardening-clean-2026-08-11` | `04da5bc32f30` | included through selected integration ancestry; no extra commits |
| ui | `release/stable-rc-ui` | `1e3606803d09` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `repair/electron-pr22` | `7c86c4b70887` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `repair/electron-pr23` | `67f94a06d6ba` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `security/deepmerge-ts-8` | `c24cf3107807` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `security/dependency-alerts` | `ef105e7a31fa` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `security/os-source-secret-vault` | `aa5bd203b029` | deferred as historical alternate/checkpoint history; preserve; published-base/current reconciliation carries reviewed behavior, no blind cherry-pick |
| ui | `wip/local-ui-integration-2026-08-13` | `37162cf62f5b` | deferred; divergent historical experiment/WIP, no reviewed release handoff |

The numerous owner-fork upstream mirror branches and independent `origin/main` history are deferred unless a separately reviewed Study Buddy handoff identifies a change. The selected current integration plus local pairing is the complete current batch; legacy startup/source-runtime/semantic/security candidates have published/current reconciliations and remain archival comparisons. No uncommitted legacy viewer work is included.

## Gates and selected regressions

- **G1 reviewed source integration and protected-default merge — pending.** combine root/UI pairing deltas with remote integration; verify advertised UI SHA before parent push
- **G2 deterministic source/security/OSS policies — pending exact combined source.** root suite/typecheck/package contracts; UI scoped tests/check/all 13 types; audit/license/SBOM/public-tree/link/submodule/secrets/CodeQL. October6 remote recorded source pass is evidence only
- **G3 feature regressions — pending exact source.** see selected feature regression list
- **G4 immutable final target build and artifact integrity — pending.** Windows11 x64/Fedora x64; unsigned Windows disclosure; manifest/root/UI/version/platform/SBOM/SHA256SUMS; no packaging before reviewed default merge
- **G5 exact-candidate VM snapshot restore authorization — pending owner-only.** approval must name exact candidate and calibrated Windows clean/Fedora clean-wallet restore; prior source request does not establish exact-artifact restore evidence
- **G6 clean installed Windows/Fedora acceptance — pending.** full setup; subscription auth; streamed thread/file read/edit/create; zero-source CRUD; no-model broker/preflight; persistence/recovery; opt-in/out telemetry; T3 coexistence; previous-public upgrade/no downgrade; cleanup/baseline restore
- **G7 publication and website promotion — authorized by owner explicit current request; execution gated.** publish release/upload website requested; only execute after required GO, exact hashes and website trusted promotion contract. Owner candidate testing/approval remains evidence to record
- **G8 public downloads/updater verification — pending.** unauthenticated GitHub asset API/hash checks; distribution-ready marker/source/SHA digest; website Windows/Linux buttons/unsigned warning/consent/failure state; downloaded bytes match accepted bundle

Run each deterministic gate once on the relevant exact combined source; repeat only after affected bytes change. Reserve full clean acceptance for one immutable final candidate. Feature-selected checks:

- Native PDF: deterministic doc→prepare/broker route and persistent attachment; real Typst 0.15.0 compilation, compound math/content-note/units and physical-page fallback; one targeted installed Moodle-to-PDF path because acquisition/rendering changed.
- Sources: exact configured origins/paths, named-course/exclusions, cached assessment/provenance, source debt/redirect/navigation, bounded three-validation failure; credentials remain broker-owned.
- Quiz: first-start/debit exclusivity, immutable native identity, alias/link protections, operation leases on Node22.16 Windows, whole original-media capture, changed-page invalidation, uncertainty blocks all fills, save/reload and final-submission refusal; use safe synthetic fixtures, no new real attempt.
- Email: native inventory/list/search/read, latest-unread UID pagination/date/order, seen-preservation, concurrent in-process policy updates, grounded recipient/session draft and exact one-use approval/decline; no additional real mail needed.
- Providers/profiles: connection persistence, inherited per-task policies, mixed workers, current Codex developer history injection, cancellation/terminal cleanup and owning account/workspace.
- Study Builder/web-layout: bounded authoring/recovery/item repair; scoped interactive-HTML tests and triage original 20 browser failures/one error against actual changed feature paths; no generic unrelated browser matrix.
- Desktop/updater/telemetry: dedicated Study Buddy identity/ports with independent T3 running, source/preflight embedded Node/SDK/CLI parity, old0.2.2 upgrade, actionable failure/no downgrade, opt-in/out privacy/queue delivery.
- UI/pairing: Quick Chat/project sidebar/composer/profile/provider/permission surfaces, voice dispatch/title privacy and loopback owner pairing isolation/symlink/output-secret guards.
- Website: trusted promoted prerelease selection, drafts/unpromoted rejection, exact platform assets, API unavailable state, unsigned Windows warning and consent gating.

Final release evidence must bind source/UI commits, build run, installer filenames/sizes/hashes, manifests, SBOMs, signing state, Windows/Fedora installed acceptance, updater evidence and website/public-download verification. Any changed artifact invalidates prior acceptance. Owner subscription authentication and exact snapshot restore approval remain genuine owner-only actions.

Machine-readable inventory: canonical ignored `study-buddy-data/releases/0.2.4-alpha-preparation/release-inventory-0.2.4-alpha.json`. This document is the source-review contract; parent owns readiness, changelog, version contracts and release notes.
