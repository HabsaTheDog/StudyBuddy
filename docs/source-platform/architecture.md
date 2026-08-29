# Generalized source platform

Status: accepted foundation, implementation in phases.

## Product model

Study Buddy will treat a source as a user-controlled block of evidence scope, not
as a credential container or an executable plugin.

```text
Source block (planner-visible scope)
        -> Connection (trusted adapter and account/site)
        -> Auth profile (vault secret and broker-owned browser session)
```

Several source blocks may share one connection. For example, one Moodle account
can back separate course blocks without duplicating credentials. A source block
contains only declarative scope, capabilities, priority, policy, and health. It
must never contain credentials, cookies, selectors, scripts, or browser-state
paths.

Initial source kinds are:

- `moodle-course`: course-aware material, structure, completed-quiz evidence,
  and the existing quiz safety rules;
- `calendar`: event reads from a private calendar connection;
- `website`: bounded anonymous or authenticated website reads;
- `resource-portal`: a website specialized for books and study resources;
- `email`: mailbox reads and local drafts, with sending disabled by default.

The planner selects source instances by capability rather than by hard-coded
provider name. Moodle and CIS remain trusted adapters during migration; CIS is
projected as a configured website/administrative portal.

## Security boundary

Source metadata and authentication material are separate:

- metadata is an owner-only, versioned registry;
- secrets, bearer URLs, OAuth tokens, cookies, and browser state are referenced
  through opaque auth-profile IDs and kept in a broker-controlled vault;
- agents receive only source IDs, declared capabilities, sanitized locators,
  semantic content, and safe health states;
- secrets never enter prompts, argv, agent environments, diagnostics,
  telemetry, run state, or normalized source records;
- authenticated browser sessions belong to an auth profile, not a run or agent,
  and are leased exclusively for bounded operations;
- adapters enforce origin/path allowlists, redirect limits, download limits,
  SSRF defenses, and operation effects.

The existing Codex filesystem/environment restrictions remain defense in depth.
They are not a substitute for a broker that simply does not expose a read-secret
operation to agents.

### Password portal authentication

Website and resource-portal password checks use a layered broker-owned state
machine:

1. Open an isolated browser context without credentials. An HTTP 401 challenge
   is retried once in a new context whose `httpCredentials` are restricted to
   the exact configured origin.
2. Otherwise, discover only visible, enabled controls in explicitly allowed
   same-origin page/frame scopes. Rank username, current-password, next, and
   submit roles from input type, autocomplete, labels, ARIA metadata, form
   membership, and bounded multilingual terms.
3. Support one username-first transition, then require deterministic password
   and submit controls. No model call is allowed after any credential is filled.
4. If the initial candidate set remains ambiguous, a bounded classifier may
   receive only pre-fill metadata and opaque candidate IDs. The broker validates
   every returned role, origin, form, risk signal, and confidence before filling.
5. MFA, captcha, passkey, OAuth/SSO consent, mutation forms, unexpected origins,
   and unresolved ambiguity fail closed or require explicit user action.
6. Replace the credential-bearing document and verify the authenticated state
   survives a clean reload before any content becomes available for extraction.

The classifier defaults to GPT-5.6 Luna at low reasoning for this rare,
small-schema fallback. Terra is a tested configuration alternative, not a
second automatic attempt. Candidate labels are bounded and secret-redacted;
field values, locators, URLs, cookies, credentials, and browser state never
enter the classifier request.

## Capabilities and effects

Capabilities describe what evidence or action a source can provide. Operations
also declare one of these effects:

| Effect | Default policy |
| --- | --- |
| `read` | allowed for an enabled source |
| `local-only` | allowed; no remote state changes |
| `reversible-write` | source opt-in or explicit approval |
| `external-commit` | exact, one-time native approval |
| `forbidden` | unavailable |

Generic websites initially expose bounded navigation, listing, reading,
searching, and downloads. Unknown forms, arbitrary script evaluation, and
unclassified mutations fail closed.

## Email policy

The first email capability set is read plus local draft. Generic webmail may
open a prefilled compose view for manual sending, but automated send is absent.

An adapter may add automated send only if its broker can prove that the exact
approved payload will be sent. Approval binds the source/account, draft ID and
revision, From/To/Cc/Bcc, subject, body hash, attachment IDs/sizes/SHA-256,
browser-session epoch, expiry, and one-use nonce. Any edit invalidates approval.
There is no permanent “always allow sending” mode.

The existing quiz approval card is a useful interaction pattern, but its
cooperative agent/file mechanism is not an authorization boundary. Email send
requires a broker-owned proposal and grant, and the broker performs the final
action after revalidation.

## Normalized evidence and compatibility

Adapters return normalized source records with stable source identity,
capability, sanitized locator, observation time, adapter/source revision, and a
content hash. During migration these records are serialized deterministically
into the mandatory `moodle_raw_text` state field, and dynamic coverage is also
projected into the existing Moodle/CIS/calendar summary.

Legacy configuration remains readable for one transition period. It is
idempotently projected into default source blocks and connections. Registry
configuration takes precedence. Secrets are migrated only through a verified
broker operation; old `.env.local` values are never deleted automatically.
