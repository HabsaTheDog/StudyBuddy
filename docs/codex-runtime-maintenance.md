# Codex runtime maintenance

Study Buddy uses the Codex executable pinned by `@openai/codex-sdk`. The global
`codex` command is diagnostic information only and is never selected implicitly.

## Normal operation

Run the authenticated compatibility check without accessing Moodle or CIS:

```bash
npm run moodle:doctor
```

Successful model checks are cached for 24 hours under
`study-buddy-data/cache/`. Every Study Buddy run writes a redacted
`codex-runtime.json` and includes the effective runtime in `run-summary.md`.

The preflight validates SDK/CLI package pairing, relevant `codex doctor` checks,
and the primary and escalation models selected by the execution policy. It runs
before source access. Registry lookup failures are advisory and do not block a
healthy installed runtime.

## Updating

The SDK version is exact-pinned in `package.json`; its lockfile dependency pins
the matching Codex CLI runtime. Dependabot checks weekly and CI verifies the
pairing, TypeScript contracts, and tests.

For a manual update:

```bash
npm install --save-exact @openai/codex-sdk@latest
npm run typecheck
npm test
npm run moodle:doctor -- --no-cache
```

Treat `0.x` minor releases as potentially breaking. Do not merge an update that
passes structural CI but fails the authenticated doctor command locally.

## Overrides and recovery

Use a different executable only as an explicit, temporary override:

```bash
STUDY_BUDDY_CODEX_PATH=/absolute/path/to/codex npm run moodle:doctor -- --no-cache
```

`STUDY_BUDDY_CODEX_COMPATIBILITY_FALLBACK_MODEL` may provide one fallback for
policy-selected models. It is never applied when the user or environment
explicitly selects `STUDY_BUDDY_CODEX_MODEL`.

`STUDY_BUDDY_CODEX_PREFLIGHT=version-only` disables auth/model probes while
retaining package checks. `off` is reserved for controlled debugging; normal
runs should use the default `full` mode.
