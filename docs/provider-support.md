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

Status: implemented and locally verified; authenticated cross-provider desktop
pipeline acceptance is pending owner sign-in. **Not production-merge accepted.**

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

## Remaining acceptance and handoff

1. Owner signs in through AI connections in the isolated Study Buddy desktop.
2. Run fresh conversations plus equivalent source-to-artifact workflows with
   Codex, Claude and Gemini; inspect prompts, internal parallel workers, native
   question/approval handling, cancellation, artifact content and model changes.
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
