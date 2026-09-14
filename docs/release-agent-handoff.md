# Release-agent entry point

## Owner contract

"Prepare the next release" means discover and reconcile the complete development
batch without asking the owner to remember changes or paste earlier chats.
Read [development-batch.md](development-batch.md), the diff since the actual last
public release, root/UI pins, all relevant local/remote branches and open PRs.
Do not assume a branch named `release/0.2.3-alpha` already includes newer work.
Use `study-buddy-release-manager`; use `study-buddy-release-lab` for the exact
frozen Windows/Fedora artifacts. Release preparation and development pushes are
not publication approval.

Create an included/deferred/blocked inventory and reconcile every backlog row
and discovered change. Take ownership of regression triage, integration, final
checks and packaged acceptance. Only owner-only authentication, permissions,
scope decisions that cannot be inferred, and final publishing approval require
the owner's action. Keep uncommitted work intact and explicitly pending; do not
claim it is pushed or silently include it in a candidate.

## Development handoff, 2026-09-14

Decision for release publication: **NO-GO / not yet accepted**. This is a source
handoff, not a release freeze or package certification. Current batch metadata
is `0.2.3-alpha`. No tag, public release, promotion or website deployment is
authorized by this handoff.

| Repository | Development branch / source | Role |
| --- | --- | --- |
| `HabsaTheDog/StudyBuddy` | `fix/dev-source-broker-v0.2.3` | Complete root batch, backlog, evidence and this entry point; use the current remote tip, not an old release branch |
| `HabsaTheDog/t3code` | `fix/dev-source-broker-v0.2.3`, UI commit `20c37cd2efc8a0ba7951c71a420ffceedf6fff11` (includes telemetry `23e6ac132`) | Study Buddy desktop/UI dependency including the concurrently completed voice-title recovery; this is the `fork` remote, never independent upstream `pingdotgg/t3code` |
| `HabsaTheDog/Study-Buddy-Website` | `design/five-directions`, commit `5d9ba28e0dfdfe4942134ecd53cd4d158bfa98d5` | Committed website design history and analytics privacy fix; publishing source is not deploying the website |
| `HabsaTheDog/study-buddy-server` | `main` | PostHog operator CLI/dashboard and active-channel runbook; separate from desktop artifacts |
| Local `Proxmox Server` repository | `main`, implementation `1db8c30` | Already deployed send-only monitoring; no remote configured, do not publish private infrastructure documentation. Desktop release does not depend on accessing this repository |

Push permission was explicitly granted for the reviewed development histories,
not unrelated dirty files. Verify exact remote SHAs at intake; do not infer a
merge or successful CI from branch presence. Root CI currently triggers on
master/PR/dispatch, so a development push alone need not start root CI. The
existing root CI matrix also includes macOS: reconcile that historical workflow
with the current Windows/Fedora release policy before the final freeze.

## Changes and open evidence the release agent must carry forward

- The full batch includes UI/sidebar/chat changes, task-profile/model assignment,
  source/workflow improvements and the fixes below. The backlog is not limited
  to this thread; compare all branches and commits to avoid omissions.
- Windows/T3 coexistence: dedicated Study Buddy port policy, foreign-renderer
  readiness rejection, actionable updater diagnostics and sanitized Codex setup
  failures. Reproduce install/update/restart with independent T3 Code running.
- Telemetry: schema8 content-free native/renderer/provider failures, consent and
  durable-queue hardening, retry/deduplication, independent identity and website
  opt-out/privacy boundaries. See [tracking audit](posthog-tracking-audit-2026-09-14.md).
- Recorded source evidence includes 1,185 web unit tests, 168 focused native/
  shared/server tests, 11 website tests, formatting/lint and 13-workspace types.
  These are historical scoped results, not exact frozen-package acceptance.
- The broad browser run recorded 20 failures and one unhandled error. Triage
  against the actual release diff and reproduce relevant defects. Do not label
  them all pre-existing or silently waive them; also do not turn unrelated
  browser matrices into new generic release requirements.
- Run final clean Windows11 x64 / Fedora x64 packaged acceptance once for the
  exact reviewed frozen candidate, with the required updater, Codex, runtime,
  persistence, consent and coexistence regressions. The owner need not remember
  or separately request these checks.
- At handoff the root, UI, website and infrastructure worktrees contain other
  uncommitted work. Those changes are not part of these pushes. Rediscover them,
  preserve them, and reconcile their ownership/readiness before the next freeze.

## Monitoring is complete, not a release blocker

The existing **Server Admin Alerts** bot (`@Proxmox_admin_bot`) is configured.
The owner explicitly confirmed receipt of `[Study Buddy] Verbindungstest` in
this thread; any older "recipient/phone confirmation pending" wording is
historical and superseded. Do not ask to pair the discarded separate bot again.

The independent server timer runs every15 minutes; three live runs passed with
1/0/0 summary handoffs, and 74 server tests (15 new) passed. It reports public
PostHog health and bounded content-free project1 error aggregates via the existing
admin notification path. No chat contents, raw logs, new receiver or copied
credentials. Runtime persistence is independent of this thread and workstation.

Scope: monitoring-path failure after two consecutive failed checks and recovery
after a successful check; native/website failures from the last24h, repeated
provider failures (threshold2), cooldown6h for changed active summaries / 24h
for identical reminders. Empty event windows are not proof an app bug is fixed.
Host/WAN/Telegram failure, missing consent, broken client delivery and permanently
offline clients remain visibility limits. No automatic repair. The server
runbook `docs/posthog-health.md` records this independently of private host docs.

## Before declaring the handoff or release complete

- Handoff: reviewed commits pushed to the intended owner remotes, exact UI pin
  remotely reachable, local-only/dirty exclusions explicit, evidence links valid.
- Release: integrate the inventory into the reviewed protected-default-branch
  commit, bind build provenance and hashes, pass required gates, record explicit
  deferrals and obtain final publish approval. A source handoff is not this gate.
