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

## Remaining acceptance and handoff

1. Finish the fresh Codex artifact rerun and any affected Gemini checks.
2. Run fresh conversations plus equivalent source-to-artifact workflows with
   Codex and Gemini; inspect prompts, internal parallel workers, native
   question/approval handling, cancellation, artifact content and model changes.
   Include image evidence, model/profile switching and restart persistence.
   Claude's live account lane is explicitly unavailable, not a required owner
   subscription purchase; retain deterministic coverage and report that limit.
   Do not treat mocks, CLI-only probes or browser-only runs as this evidence.
3. Investigate any real-account failures before calling this production-merge
   ready. No real provider quality, timing or token-cost comparison exists yet.
4. At deliberate batch freeze, retain the full release review and exact-candidate
   Fedora/Windows packaged acceptance gates. No version bump, tag or publication.

Implementation commits: root `ed219ee`, UI dependency `b4bef0b81` (local only).

Development branches are local only: root `feat/provider-support`, UI
`feat/study-buddy-provider-support`. Neither is pushed, merged, deployed or
release-accepted by this task. The independently installed T3 Code was not used
as the test application or modified.
