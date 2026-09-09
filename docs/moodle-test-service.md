# Local Moodle test service

## Scope and current status — 2026-09-08

The owner chose on-demand **local rootless Podman** on the development
workstation. The earlier Proxmox/tunnel proposal is superseded: do not create
server guests, publish hostnames, change router rules or involve the separate
Proxmox MCP implementation.

Commands and input digests are in
[scripts/moodle-lab/README.md](../scripts/moodle-lab/README.md).
Implemented: real Moodle bootstrap, synthetic Windows/Fedora student accounts,
known page/PDF/text fixtures, guarded reset, HTTP acquisition probe and private
local service control socket. No changes to the personal Study Buddy app.

Verified so far:

- Official Moodle 5.1.6 archive checksum; PHP/PostgreSQL images downloaded and
  pinned by digest.
- Both PHP scripts passed PHP 8.4 syntax checks during initial preparation.
- 13 lightweight tests pass: HTTP cookies, corrupted files, origin rejection,
  resource preflight, private control socket, reset guards and credential-free status.
- Low-memory startup refuses before creating containers.

**Pending:** real Moodle installation/seeding/HTTP acceptance, Windows/Fedora
packaged acquisition and automated guest credential entry. The host has roughly
4–5 GiB available RAM with nearly full swap; startup requires 9 GiB to retain
the owner's 8 GiB reserve. No ongoing Moodle service or test VM was started.
Do not waive this guard or claim these pending checks passed.

## Lifecycle

One foreground service owns two bounded containers (512 MiB PHP / 256 MiB
PostgreSQL), a private internal network and loopback-only random HTTP port.
It runs server acceptance before announcing readiness. Agents can request
status, probe, reset and stop through an owner-only UNIX socket under ignored
`study-buddy-data/moodle-lab/`. No system service or autostart is installed.

Passwords are synthetic and regenerated each start. Student passwords remain
in the foreground process; database configuration lives in the private
temporary fixture tree/container lifetime. Do not collect raw container logs,
configuration or credential responses as evidence. The credentials command
is for the owner's private terminal; safe automated guest entry is not
implemented yet. No API key or university credentials are needed for Moodle.

Stop, Ctrl+C and normal termination remove recorded containers, their
anonymous volumes, internal network and private temporary data. SIGKILL or
host crashes cannot guarantee cleanup: inspect only `sb-moodle-check-*`
resources and validate exact ownership before removal. Cleanup failures
retain private files for recovery and report failure.

## Remaining local-app integration decision

Study Buddy requires public HTTPS source URLs and rejects loopback/private
addresses. See `src/custom-skills/moodle/urlSecurity.ts` and the fork's
`apps/server/src/custom-skills/moodle/browserSecurity.ts`.

The server-only test's explicit HTTP-loopback allowance does **not** change
application policy. This local service cannot yet be added to an unchanged
published app. Do not disguise this as a desktop pass, disable TLS/DNS
protections, expose a public tunnel or silently introduce a production allowlist.

A follow-up needs an explicitly scoped development-test access mechanism,
including guest transport and credential entry, with production-rejection
regression tests. If it uses a modified test artifact, label its evidence as
development integration, not acceptance of unchanged published bytes.

## Acceptance levels

1. **Real server:** valid/invalid login, anonymous denial, student privilege
   restriction, exact content, guarded reset and identical reseeding.
2. **Desktop integration:** actual source setup/acquisition in installed
   Windows/Fedora apps, identifying exact artifact and any test-only config.
3. **Model-backed guide:** selected app thread using those contents; validate
   source facts/artifact behavior rather than identical generated wording.

Keep calibrated blank VM snapshots and full app setup, not warmed or
authenticated snapshots. Codex uses the dedicated ChatGPT subscription handoff.
Full model-backed generation is deferred for this setup and is not required
for every unrelated release. Never submit a final quiz.
