# Generalized source platform implementation plan

## Hard requirements

- Keep Moodle/CIS acquisition under `src/custom-skills/moodle/` and preserve the
  strict LangGraph state fields and three-retry behavior.
- Preserve course hierarchy, provenance, source coverage, and the existing
  Moodle quiz permission. Final quiz submission remains permanently denied.
- Keep authenticated values out of agents and generated artifacts.
- Do not enable automated email send until exact-payload broker enforcement and
  native approval pass the security tests below.

## Phase 1 — contracts and immediate hardening

- [x] Add versioned source, connection, auth-status, capability, policy, health,
  normalized-record, and operation-effect contracts.
- [x] Add deterministic capability-based source selection.
- [x] Add an idempotent secret-free projection for legacy Moodle/CIS/calendar
  configuration.
- [x] Add immutable email draft hashing and exact one-time approval contracts.
- [x] Stop returning the configured private calendar bearer URL to the renderer.
- [ ] Move source metadata to server-owned application state and secret material
  to an OS-backed desktop vault with a narrow server-store fallback.

## Phase 2 — adapter registry and compatibility wrappers

- [ ] Add a trusted adapter registry with `probe`, `read/search`, `acquire`, and
  normalization operations plus declared effects.
- [ ] Wrap the existing Moodle, CIS, and calendar nodes without changing their
  observed graph behavior.
- [ ] Feed normalized records into a deterministic legacy
  `moodle_raw_text`/coverage projection.
- [ ] Add dynamic per-source coverage while retaining the old aggregate fields.

## Phase 3 — source inventory and setup

- [ ] Add source CRUD/test/auth RPCs keyed by stable source ID.
- [ ] Replace fixed Moodle/CIS/calendar settings sections with a source inventory
  and adapter-driven Add Source dialog.
- [ ] Change setup to choose source type, authentication method, bounded scope,
  capabilities, connection test, and save.
- [ ] Discover child Moodle-course blocks from one Moodle connection.
- [ ] Migrate legacy settings idempotently and offer explicit cleanup only after
  successful connection checks.

## Phase 4 — generic websites

- [ ] Add bounded anonymous website reads.
- [ ] Add broker-owned authenticated sessions with per-auth-profile partitions,
  headed MFA/passkey login, origin/path allowlists, and exclusive leases.
- [ ] Add safe page/list/search/download operations; deny unknown mutations.
- [ ] Treat page content as untrusted evidence and retain provenance.

## Phase 5 — email read and draft

- [ ] Add provider-neutral thread/message/attachment records.
- [ ] Prefer provider/API or mail-protocol adapters; use bounded webmail as a
  fallback.
- [ ] Support local drafts first. Remote draft autosave is a separately declared
  reversible write.
- [ ] Provide a user-opened compose view for manual send.

## Phase 6 — separately reviewed email send

- [ ] Add broker-owned immutable send proposals and native approve/decline UI.
- [ ] Bind grants to exact recipients, content, attachments, account, session
  epoch, expiry, and nonce.
- [ ] Revalidate and consume a grant atomically in the broker; reject changes,
  replay, expiry, wrong account/session, and concurrent sends.
- [ ] Enable only adapters that can prove exact-payload execution. Generic
  webmail remains manual-send only.

## Verification matrix

- Adapter conformance: capabilities, effects, normalized provenance, coverage.
- Secret canaries: argv, environment, prompts, logs, diagnostics, telemetry,
  errors, snapshots, source records, and generated files.
- Browser security: redirects, SSO origins, MFA, expiry, revocation, SSRF, DNS
  rebinding, private networks, credential URLs, leases, crashes, cancellation.
- Migration: complete, partial, malformed, shared credentials, already migrated,
  rollback, explicit cleanup.
- Email approval: changed draft/recipient/attachment, expiry, replay, wrong
  source/account/session, decline, cancel, concurrent execution, one-time use.
- Existing root verification plus Study Builder benchmark hard gates and proof
  that final Moodle quiz submission is still impossible.

