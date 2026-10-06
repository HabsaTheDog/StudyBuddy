# Provider integration — implementation contract

Owner request (2026-09-22): install and connect OpenAI Codex, Anthropic Claude
and Google Gemini/Antigravity in Study Buddy; allow onboarding to be skipped;
preserve prompts, internal workers, permissions and artifact validation with
every selected provider. Complete development verification before handoff.

Baseline: root `fix/dev-source-broker-v0.2.3`, UI `b2eecc505`; both clean.
Working branches: root `feat/provider-support`, UI
`feat/study-buddy-provider-support`. No publication or release freeze requested.

Reference: upstream `pingdotgg/t3code` main `b5a0f8101`, fetched 2026-09-22,
detached reference worktree `/tmp/study-buddy-t3-provider-reference-b5a0f8101`.
Reference stays separate from the independently installed T3 Code application.

## Implementation and acceptance

1. Backport the upstream Antigravity ACP runtime, managed installation and
   owned authentication flow, adapting their contracts to this fork.
2. Present Codex, Claude and Gemini installation/sign-in and optional onboarding.
3. Propagate provider instance selection through coordinator instructions,
   workflow configuration and internal model calls. Do not silently run Codex
   when a different provider was selected. Preserve exact prompt, schemas,
   attached evidence, cancellation, admission and bounded retries.
4. Exercise provider-specific installation/authentication and session boundaries
   with deterministic tests, including errors, cancellation and isolation.
5. Run root verification, fork check/typecheck, affected provider/UI regressions
   and actual Study Buddy desktop-dev acceptance. Record any unavailable account
   authentication as an acceptance gap, never as a live pass.
6. Review final diffs, make scoped local commits and update development backlog
   with exact evidence and remaining release gates. No tag/publication.

Status: implemented and locally verified. The owner connected Codex and Gemini;
Gemini completed a real conversation. Desktop acceptance has resumed; Gemini has produced a validated worksheet and both providers passed image understanding. Codex artifact acceptance is being rerun after two runtime fixes. Claude has no subscription and is covered
by deterministic regressions, as requested. **Not production-merge accepted.**

## Implementation

- Current T3 Antigravity installer, Google authentication ownership and ACP
  runtime backported to the fork's Effect beta.78 contracts. Upstream currently
  uses beta.103; wholesale replacement would introduce unrelated migrations.
- Three install/connect choices in onboarding and AI connections; users can
  skip provider setup, keep several providers enabled and select their model
  in the composer. Existing Codex installation/login is retained. Claude uses
  its official native installer without requiring npm. Gemini installation
  validates the pinned official archive and the running ACP identity.
- Coordinator instructions, personality and execution profile reach native
  sessions. Task progress, completed/failed/cancelled state and native answer
  IDs survive the runtime projection. ACP opaque IDs cannot collide with
  negative numeric IDs.
- Study Buddy internal workers use the owning thread's provider instance via
  an authenticated loopback bridge. The server resolves the current model,
  avoiding stale process environment values after model changes. Prompt text,
  images, output schemas and cancellation propagate; native failures never
  silently invoke Codex. Native worker usage is unknown, not fabricated.
- Claude and Gemini workers run in temporary isolated directories, with tools,
  hooks/MCP and further delegation disabled. Existing pipeline concurrency,
  evidence validation and retry limits remain authoritative. Native HTML
  repairs return bounded exact text edits, applied locally while preserving
  embedded learning banks; Codex retains its existing repair path.
- Thread titles and initial worktree names use the selected provider. Claude
  status explicitly checks login rather than treating SDK initialization as
  proof of authentication. Setup uses the same configured Claude HOME as
  sessions and isolates it from Codex setup.

## Verification, 2026-09-22

All evidence below is development/source evidence, not packaged acceptance.
Local logs are retained under `study-buddy-data/provider-acceptance/evidence/`.

| Check | Result |
| --- | --- |
| Root `npm run verify` (manifest contract, TypeScript, complete workflow suite) | 155 files; 1,237 passed, 4 skipped |
| Complete web unit suite (`vp test --project unit --maxWorkers 2`) | 127 files; 1,187 passed |
| Providers, text generation, ACP, profiles, settings, ingestion/reactor and server regression | 64 passed files, 1 skipped; 969 passed, 4 skipped |
| Fork `vp check` and `vp run typecheck` | No lint/format warnings; all 13 typecheck tasks passed |
| Real Electron onboarding | All three install/connect choices present; provider step skipped; reached app; connections remain accessible in settings |
| Real composer | Claude model selected; stale duplicate coming-soon entries removed; explicit model choice retained |
| Actual Claude installation | Native installer succeeded; CLI 2.1.278 detected |
| Actual Gemini installation | Official 1.1.1 archive downloaded, checksum/extraction/ACP validation succeeded; managed runtime persisted across restart |
| Authenticated conversation and full pipeline, all three providers | **Pending** — isolated Codex and Google accounts are unconnected; real Claude attempt correctly revealed missing authentication |

The first Gemini attempt used an older running backend bundle and failed;
acceptance refers only to the subsequent rebuilt desktop attempt. An initial
cross-package test invocation omitted web aliases; those UI suites were rerun
with their web project configuration, and the full web suite passed. Neither
failed attempt is counted as an acceptance pass.

The real Claude attempt exposed a false-positive signed-in status inherited
from the original provider probe. A regression now proves that local SDK
initialization with `loggedIn:false` remains unauthenticated. No successful
Claude model response is claimed. The final rebuilt Electron instance confirms
that all three installed providers correctly show sign-in required.

## Settings cleanup, 2026-09-22

Local UI follow-up `20d96c744` replaces the duplicated onboarding and management
cards with one ordered list: Codex, Claude, Google Gemini. Each default provider
opens its own install/account dialog; model management and technical details
remain under Advanced. Unsupported default placeholders are hidden, custom
instances remain available, and model rows deduplicate exact model IDs. Gemini
uses its provider icon. The initial onboarding still offers all three providers.

Validation: 10 focused settings/setup tests passed, full lint/format passed and
all 13 workspace typecheck tasks passed. The actual Study Buddy Electron renderer
confirmed exactly three default provider headings, one provider per connection
dialog, and working Advanced expansion. Settings and a connection dialog were
also checked at 390px width without horizontal document overflow. Desktop and
narrow screenshots are retained in
`study-buddy-data/provider-acceptance/evidence/settings-clean-{desktop,narrow}.png`.
These checks do not replace the pending authenticated pipeline acceptance.

## Authenticated acceptance and hardening, 2026-09-22

The owner authorized live Codex/Gemini testing and explicitly replaced live
Claude acceptance with robustness checks because no Claude subscription exists.
The hardening changes are in local UI commit `44fedd992`.
Testing uses the regular Study Buddy development profile at
`output/t3-study-buddy-t3-home`, not the earlier isolated installation profile.

- Codex reported authenticated subscription access in the actual Electron app.
- Gemini's saved Google login was verified without another OAuth login.
  A fresh Gemini 3.8 Flash (Medium) conversation completed in 12 seconds with
  the exact original prompt and Unicode symbols preserved. Thread:
  `1cc636d2-44fd-4e6b-bc7c-877407f916c2`. This is conversation evidence only.
- The first conversation revealed that changing the provider reset Balanced
  to the user's default custom profile. Model changes now preserve the selected
  profile ID. The next desktop draft and persisted thread both retained Balanced.
- A fresh Gemini worksheet thread,
  `985e556f-8fa1-421c-be78-3d3972d53d4f`, reached native tool execution but did
  not start the artifact workflow before a workstation reboot interrupted it.
  It is not a successful pipeline round; no artifact or worker token totals
  are claimed. The persisted turn outlived its process. The desktop Stop action now clears an absent or recovered idle runtime; this exact turn was stopped through the UI before replacement.
- That run exposed Unix socket failures in child Node/tsx commands because
  Antigravity's inherited TMPDIR included the full workspace/profile path.
  Runtime temp roots now use a short, profile-specific hash; per-process
  isolation, close-time cleanup and startup orphan cleanup remain intact.
  Startup also removes obsolete temp files in the old profile location.
- Gemini's inexpensive health probe overwrote saved authenticated state after
  restart. The reference T3 saved-account merge behavior is now backported,
  preserving explicit sign-out, disabled state, errors and auth-method changes.
  The connection card also offers Check connection for an unchecked saved login.
- Claude workers reject error envelopes even when they contain stale structured
  output, and cover account failures, malformed output, schema mismatch, exact
  multiline/Unicode prompts and tool/hook restrictions. Client regressions cover
  in-flight cancellation and malformed native responses for Claude and Gemini.

Evidence is retained in `study-buddy-data/provider-acceptance/evidence/live/`:
the initial lane ledger, full test logs, desktop launch diagnostics and focused
regressions. Root manifest/typecheck passed; all 1,241 root tests passed with
4 skipped after limiting test concurrency to two workers. The initial concurrent
run hit one 5-second CLI timeout; that case passed alone and in the complete
bounded rerun. Provider/backend regression: 726 passed, 4 skipped. Full web
suite: 1,188 passed, with 3 additional new Gemini recovery tests passed separately.
All 13 workspace typechecks and full formatting/lint checks passed. These are
source checks. The resumed desktop confirmed short temp paths work and saved Gemini authentication survives restart.

## Resumed desktop checks, 2026-09-22

The owner restored the graphical session. All following live lanes use the
actual `pnpm study-buddy:app` Electron shell and its regular development profile.
No additional provider login was needed.

- UI `86b160ffe`: Stop now closes persisted running turns whose native process
  no longer exists, including idle sessions recovered after reboot. Reactor:
  40 tests passed; the original interrupted Gemini turn was stopped in the app.
- UI `bef466f76`: worksheet previews permit local form handlers. CSP continues
  to forbid network form submissions. Three policy tests and two real Chromium
  regressions cover both sandbox variants, successful local checking and denied
  navigation. Gemini's generated worksheet opened through its chat attachment;
  all five correct answers were accepted in the desktop preview. Generated
  artifact bytes were not patched.
- Gemini worksheet `857f8084-0800-4998-ad33-78ddebb1cf40`: Balanced,
  Gemini 3.8 Flash (Medium), 286 seconds app duration, 91 seconds pipeline.
  Planner, builder and reviewer completed; original prompt preserved; no
  retries or repairs; HTML validation passed at four viewport sizes; 706,917
  byte published artifact. All three model calls report unknown token usage.
  The coordinator's long final summary described some examples inaccurately;
  the actual artifact and its checks are the authoritative evidence.
- Gemini image `8fc530d6-6130-4f48-bdd4-26e428a60765`: Balanced, 15 seconds.
  Codex image `fcff7884-9dc7-4165-9c05-cdc6a61536bc`: Balanced, 5 seconds.
  Both read the attached K7 card, three blue squares, two red circles, 18 Ω,
  36 V and correctly calculated 2 A. The expected data was in the image,
  not the prompt. Clipboard paste, attachment persistence and native vision
  were exercised through the real desktop composer.
- Codex worksheet `b4cc38aa-56d5-4e99-9e2c-fb03a43efe29` failed: first
  builder timeout after 240 seconds; retry terminated by the 300-second idle
  watchdog. Both app and worker ended; no valid HTML or pass is claimed.
  Investigation found dropped CODEX_HOME in native shell children and a
  non-leaf HTML builder loading the global workflow skill. The generated
  account policy now propagates CODEX_HOME, and web-layout text builders use
  isolated read-only workers with a no-tools boundary. Regressions also reject
  unexpected tool calls. Fresh rerun: `0a954161-aaeb-442b-8b46-9eb39d110a3b`.

Latest source checks: root 156 files, 1,244 tests passed, four skipped;
11 focused model/worker regressions; five account-policy tests; all 13 fork
workspace typechecks and full lint/format passed. Browser regression initially
could not find its downloaded Chromium executable; rerun with installed Chrome
passed. These are development checks, not packaged acceptance.

### Final recovery changes

- All providers now repair HTML through schema-validated, exact unique text
  edits applied by the workflow. Codex no longer receives file-edit instructions
  in a read-only worker. Embedded learning banks remain protected and base64
  media is omitted from the editable prompt. This fixes the mismatch exposed
  by the Fast diagnostic's attempted heading repair.
- Design guidance explicitly uses the requested language for section labels;
  English generation is no longer told to use German labels.
- The HTML CLI forwards SIGINT/SIGTERM to its graph and active model request.
  A subprocess regression observes request disconnection, exit status 1 and
  release of the run lease, with no second model call.
- Built-in Balanced retries its artifact builder on Terra/high after Sol;
  custom profiles retain their explicit choices. Terra completed a real build
  in the Fast diagnostic after Luna timed out. The output still failed its
  language review and old repair contract, so that round is not a pass.
  Policy version: `2026-09-22.1-provider-recovery`; UI `63248c0b6`.
- Final checks: 1,246 root tests passed, four skipped; 31 focused model/repair/
  cancellation checks and 12 shared-profile tests; all typechecks and lint pass.
- A clean desktop relaunch needed `XDG_SESSION_TYPE=x11` after native Wayland
  startup hung. This still launches the actual Study Buddy Electron shell via
  `pnpm study-buddy:app`, with the same authenticated profile. Wayland startup
  is not certified by the subsequent X11 acceptance.
- Final live lanes: Codex Balanced `f0b259ad-549e-40f4-bbe0-2d315af998d1`;
  Gemini image-to-exercise `0a2f2ec9-7ba1-4138-82f3-3759a397e84f`.

## Original-request and workspace hardening, 2026-09-29

The September 22 final lanes exposed two additional acceptance failures:

- Codex `f0b259ad-549e-40f4-bbe0-2d315af998d1` completed a validated worksheet,
  but published it under the application root after changing directory. The
  Quick Chat preview correctly rejected that out-of-workspace attachment.
- Gemini `0a2f2ec9-7ba1-4138-82f3-3759a397e84f` generated an image-based exercise,
  but its coordinator replaced the original request with a paraphrase that
  invented a relationship between decorative shapes and electrical values.
  The downstream review could not identify that contaminated source contract.

Neither lane is counted as desktop end-to-end acceptance. Their outputs remain
unmodified as diagnostic evidence.

The follow-up sends each Codex thread's workspace and thread ID through native
shell configuration. Authenticated workflow context now supplies the exact
active user request and its image attachments, excluding queued future turns.
Voice transcripts are recovered from the original turn event without changing
visible chat messages. Standalone CLI calls retain their explicit input.
The HTML planner, builder and reviewer receive the actual source images;
branding is excluded. A workflow monitor aborts when its owning turn stops or
changes. Preview filesystem boundaries remain enforced.

Verification: 1,254 root tests passed, four skipped; 890 provider/text-generation/
orchestration regressions passed, four skipped; 43 affected projection/startup/
checkpoint tests passed; lint and all 13 fork typechecks passed. New cases cover
Unicode, queued messages, voice input isolation, authenticated context access,
loopback enforcement, image propagation, cancellation and run-lease cleanup.
The source desktop is running through X11 with its existing accounts.
Fresh final desktop lanes:

- Codex `8393be44-1c9d-449c-9cb1-b1553d9cf79d`: **desktop-dev pass**,
  Balanced, 299 seconds app duration / 258 seconds pipeline. Four leaf model
  calls, 72,126 input and 13,202 output tokens reported; no transport/task
  retry, one bounded repair for a missing Study Buddy identity mark. Original
  prompt matched exactly; run and published attachment stayed in Quick Chat.
  The actual desktop preview rejected a wrong answer, accepted all five correct
  answers (27, 30, 25, 92, 180), opened solutions, and reset answers successfully.
  Published HTML: 715,470 bytes; SHA-256
  `102bdb582c65bb9795f3aa17f4eca2bf90b9f76b90303ba6f0e79f063cf0e3d9`.
- Gemini `65ee19e1-5b42-4f27-be83-40c9cb07b39f`: **failed artifact contract**,
  Balanced, 15 seconds, zero workflow calls/tokens. The card values and current
  were correct, but the response was chat text with a static answer disclosure.
  No HTML workflow was launched, so this is not pipeline acceptance. The shared
  coordinator instructions now explicitly require a validated published artifact
  for a requested working answer checker, even without the words HTML/file.
  Ordinary explanations and requests restricted to chat remain conversational.
  All 104 affected profile/Codex/Gemini/Claude instruction-adapter checks passed.
  No follow-up repair was sent to this thread.
- Gemini `6329087b-2296-4bdb-9133-de75027b6dc1`: **desktop-dev pass**,
  Balanced, 159 seconds app / 59 seconds pipeline. Three native workers, zero
  retries or repairs; token usage is unavailable for all three calls. Exact
  original prompt and current image attachment were preserved, even though
  the coordinator reused an old expanded command. The published file correctly
  shows K7, 36 V, 18 Ω and 2 A without inventing a shape/value relationship.
  Desktop preview rejected 3 A and accepted 4 A for its 60 V / 15 Ω practice
  question. The step-by-step explanation is present and correct. Published
  HTML: 695,576 bytes; SHA-256
  `f0422600a4973f9e629c802fdcc067bad9e3202c30341a6dbbdb8d0d3da10892`.

All 14 retained lanes are terminal. No active workflow worker remains for the
final lanes; `sbtest a` reports an empty inventory. Standalone web-layout runs
are not fully discovered by `sbtest i`, so run-events, metrics, summaries and
process state were inspected directly as well. The final lane ledger and
reviewed screenshots are under `study-buddy-data/provider-acceptance/evidence/live/`.
The one canceled historical run with stale `running` metrics remains preserved
as failure evidence; it has no live process. Independent T3 state was untouched.

## Acceptance and release handoff

The provider feature's source/native desktop acceptance is complete for Codex
and Gemini, including real chat, image evidence, model/profile selection,
restart persistence, pipeline workers, bounded HTML repair and usable artifact
previews. Cancellation has deterministic owner-turn/SIGTERM/HTTP-disconnect
coverage and a retained native Gemini stop lane; detached arbitrary shell
commands remain distinct from supervised artifact workers.

Claude installation/authentication/worker/error behavior has deterministic
coverage and actual installation evidence. No authenticated Claude generation
is claimed: the owner has no subscription and explicitly accepted this limit.
Gemini worker token usage is unavailable. No comparative quality, token-cost,
or runtime improvement is inferred from these different diagnostic workloads.

Implementation commits include root `e57c512` and UI `36b46555f`, followed by UI
`a1435c669` for the answer-checking artifact contract. These build on the scoped
provider/setup/settings/repair commits recorded above.

Development branches are local only: root `feat/provider-support`, UI
`feat/study-buddy-provider-support`. Neither is pushed, merged, deployed or
release-accepted by this task. Push the reviewed UI dependency before the root
pointer only when authorized. No version bump, tag or publication occurred.

At deliberate batch freeze, retain the holistic release review and clean
Fedora/Windows acceptance on one exact packaged candidate. Source and native
development checks do not certify a packaged release. The final X11 checks do
not certify the earlier problematic native Wayland startup path.
