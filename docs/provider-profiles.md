# Provider-specific execution profiles

## Product contract

The composer shows one profile picker with saved personal/mixed profiles first.
Its built-in section has provider icon tabs when more than one supported connection
is authenticated and usable. Tabs stay available in existing chats for browsing;
choosing another coordinator remains limited to a fresh chat, with an explanation
shown above that provider's profiles. Codex and Claude offer Fast, Balanced, and Quality;
Gemini offers Fast/Balanced Flash thinking policies, collapsing to one Balanced
preset when its catalogue cannot distinguish them. See the
[2026-10-01 profile refresh](provider-profile-refresh-2026-10-01.md) for assignments,
pricing, compatibility and development evidence. A single connected provider is
selected automatically for new Quick Chats.
Settings remembers a default connection and a default profile for each connection.
Existing chats retain their profile. Active conversations respect provider session
continuation restrictions; switching a coordinator to a different provider may
require a fresh chat. Mixed custom profiles route their workers independently.

Custom profiles belong to their coordinator connection. A profile with explicit
worker or fallback connections different from its coordinator is also offered as
a mixed profile. Existing saved profiles are retained; absent worker connection
fields inherit the coordinator. Changing a custom coordinator freezes inherited
worker connections before switching it, so old model slugs cannot be silently
sent to a different account.

## Implementation plan

1. Add backward-compatible worker/fallback instance ids and per-connection defaults.
2. Resolve provider-specific built-ins from live model catalogues. Keep established
   Codex policies; use Haiku/Sonnet/Opus tiers for Claude and catalogue-reported
   Flash effort variants/Pro models for Gemini. Never invent a catalogue id.
3. Replace the composer model picker with a profile picker with internal provider tabs and
   a persistent personal/mixed section. Group provider/custom/mixed profiles in Settings.
4. Forward explicit instance/model/reasoning assignments across every CLI client;
   keep task inheritance, bounded validation, cancellation, images, original
   request handoff, and provider-specific account isolation.
5. Authorize cross-provider bridge dispatch against the owning profile. Reject
   unassigned, disconnected, or stopped-owner requests. Preserve the existing
   direct Codex SDK path and usage metrics for workers on its coordinator account.
6. Test persistence, migration, tier resolution, scoped editor and composer,
   routing/fallback, unavailable connections, and native desktop pipelines with
   connected Codex/Gemini. Claude uses deterministic coverage because the owner
   has no subscription. Capture UI evidence and record exact acceptance limits.

## State

Provider-specific built-ins, per-connection defaults, internal provider tabs,
mixed custom worker/fallback routing and profile migration are implemented.
Source development verification passed. Frozen-candidate packaged release gates remain separate.

## Desktop evidence, 2026-09-30

Every lane uses the actual Study Buddy (Dev) Electron shell, port 9515, with dedicated
state under `output/t3-study-buddy-t3-home/dev`. Each is a fresh Quick Chat with one
natural request, no follow-up repairs and the selected profile persisted in SQLite.
Existing user profiles and authenticated connections are retained.

| Lane / thread | Workflow duration | Result and model paths |
| --- | --- | --- |
| Gemini Balanced density · `f1e01cfd-5d99-4aa9-a9c8-818482343df7` | 284,399 ms | Passed; Flash planning, Pro builder/review, bounded Flash repair fallback; five model calls, one retry, two repair calls; validated HTML attached |
| Initial Gemini + Codex fractions · `81a31828-3d6b-4da8-a4e9-47a690be523c` | 233,625 ms | Failed/stopped; Codex instruction discovery failed in the filesystem sandbox before receiving its prompt. Four calls, two retries; diagnostics retained, owned worker exited |
| Sandbox-fixed mixed fractions · `339033fa-87dd-448d-8e5e-c66b6480c43a` | 221,044 ms | Passed through fallback; Codex's successful output was rejected because its startup warning used an `error` item. Gemini builder fallback and Flash reviewer fallback completed; five calls, two retries, no repairs; validated HTML attached |
| Codex + Gemini units · `072ebb7c-bbec-4a74-a5cb-7b5d7506b98d` | 400,882 ms | Passed through bounded fallback; Codex coordinator, Gemini Flash planning/review, Codex Sol builder timed out at 240 s and Terra fallback completed; four calls, one retry, no repairs; validated HTML attached, owner ready |
| Final Gemini + Codex adding fractions · `abb75a6e-f827-419a-bab2-fb449bbcdd31` | 121,219 ms | Passed; Gemini Flash planner → Codex Terra builder → Gemini Pro reviewer; three calls, zero retries/repairs, validated HTML published and attached; owner ready |

The prompt-only Codex helper now disables project instruction discovery with
`project_doc_max_bytes=0` while retaining `study_buddy_analysis` permissions and
secret-file restrictions. Diagnostic `error` items are permitted; process failure
and actual tool events still reject the result. Regression checks cover both.
The setting is documented in the [official Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

Native bridge usage is unavailable and recorded as unknown, not measured zero.
The reverse mixed lane preserves direct Codex SDK accounting: Terra reports 15,142
input tokens and 7,249 output tokens, including 383 reasoning tokens; the other
three calls have unknown usage. All completed lanes above have zero reported
workflow tool-policy violations.
Canonical run artifacts, validation/quality reports, screenshots and test logs are
retained in the dedicated Quick Chat runs and `study-buddy-data/provider-acceptance/`.
The inspector's current active-run discovery does not recognize standalone HTML
runs and can mistake reused stale PID values for unrelated processes. Acceptance
therefore also verifies the owning thread, persisted run events/metrics and real
process command lines; unrelated processes are never stopped.

## Final regression gates

- Root `npm run verify`: 159 files, 1,294 passed / four skipped, including root typecheck and package contracts.
- Backend `vp test run --maxWorkers 2`: 173 files, 1,687 passed / five skipped.
- Frontend complete unit + Chromium browser suite: 149 files, 1,422 passed.
- Shared profile/settings tests: 23 passed; mixed CLI routing/fallback checks: 34 passed.
- Full fork `vp check`: all 1,724 files formatted, no lint warnings/errors in 1,619 files.
- Full fork `vp run typecheck`: all 13 workspaces passed; source server/web build passed.
- Actual Electron: Gemini-only hides the connection picker and starts Balanced automatically.
  Draft `1280f0f1-b8f9-423e-bd90-1cf2d545387b` restored exact unsent Unicode text
  and Gemini Balanced selection after page reload. The diagnostic text was cleared,
  Codex re-enabled and existing provider accounts retained. Disabling the provider
  after the completed reverse mixed run marked that already-finished owner session
  stopped; it did not change the successful artifact run.
- Native HTML attachment previews opened both final mixed artifacts. Wrong answers
  were rejected, correct answers accepted, and hints/worked solutions opened. The
  fractions page reached 2/2 correct tasks; the units worksheet reached 3/3 goals.
- All five owned generation threads and their official artifact runs are terminal.
  No owned Codex exec or HTML CLI worker remains alive.

## Regressions found during integration

- Quick Chat draft hydration could replace its explicit physical project scope
  with an opaque logical `quick-chat:` key. The saved scope is now retained, with
  legacy hydration behavior covered separately.
- Older tests expected a raw model picker, Codex-only mandatory onboarding,
  unsupported default provider rows and obsolete module mock paths. Fixtures now
  exercise profiles, optional three-provider setup and retained custom connections.
- The Claude interrupt fixture completed its turn immediately; its session now
  remains running until interrupted for that test, matching the reactor contract.
- A legacy global mixed profile cannot override the selected default connection.
  Setting a mixed profile as default records its actual coordinator connection.

## Acceptance limits

Claude has deterministic installation/authentication/error/profile/routing coverage;
there is no live subscription and the owner explicitly accepted that limit.
These source-tree desktop runs do not certify clean packaged Windows/Fedora installs,
updater behavior or release readiness. The open development batch needs deliberate
freeze, holistic review and exact-candidate packaged acceptance before publication.
