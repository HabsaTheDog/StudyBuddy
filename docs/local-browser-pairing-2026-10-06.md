# Local browser pairing for external Study Buddy agents

External T3 agents previously reached `/pair` but were sent back to the owner
to enable network access and copy a token. The backend already supported local
one-time grants. Settings hid authorized-client management when network access
was disabled, and the desktop-local auth descriptor omitted one-time pairing.

Settings now expose pairing to authenticated owners with `access:write` on
loopback. Non-admin clients still cannot manage access. Desktop auth descriptors
advertise both desktop bootstrap and one-time pairing without changing the
`desktop-managed-local` policy or the listening interface.

## Agent helper

The root `browser:pair` command uses the existing server auth CLI to issue one
fresh standard-client grant, valid for five minutes. Select the actual Study
Buddy runtime explicitly; the development URL selects `dev/state.sqlite`, while
an installed runtime without that flag selects `userdata/state.sqlite`.

```sh
npm run browser:pair -- \
  --base-dir '/absolute/Study Buddy runtime root' \
  --dev-url http://127.0.0.1:5853 \
  --ui-url http://127.0.0.1:5853 \
  --check
```

Remove `--check` to issue the grant. The command prints only public metadata
and a private credential-file path. Read that newly issued credential locally,
enter it in the normal `/pair` UI, confirm authenticated access, and delete the
temporary file. Do not print tokens or reuse desktop bootstrap credentials.
The default file is exclusive and mode `0600` under ignored workflow state.
The helper requires an existing database, the matching built CLI, a loopback
Study Buddy UI, and rejects independent T3 state including symlinked databases,
state metadata, secrets and output ancestry. It strips inherited app-specific
environment overrides and never enables network access or restarts the backend.

The installed global `study-buddy-ui` skill now teaches this procedure and wraps
it in `scripts/sb_ui.py pair`. This global installation is outside repository
history; its verified archive is retained under `study-buddy-data/skill-packages/`.
The archive needs this helper in the selected Study Buddy checkout.

## Development verification

- Seven helper tests and the workflow-package guard pass (eight root tests).
- Four auth suites pass (23 tests, including the five policy cases).
- Two real HTTP regressions pass: descriptor and local owner-issued pairing,
  single-use exchange, anonymous issuance denial and standard-client denial.
- Four browser regressions pass: local owner visibility, non-admin hiding,
  and actual local/network Create link flows with exposure setters untouched.
- Full UI format/lint checks and all 13 workspace typechecks pass; server
  typechecking was repeated after the new HTTP regression.
- Independent review identified and closed state/secret symlink isolation gaps.

Live browser-diagnostic proof used the existing loopback development runtime
after an online SQLite backup. The official CLI issued a fresh grant; the browser
entered it through the visible Pairing token / Continue flow. The authenticated
session returned HTTP 200, `desktop-managed-local`, standard scopes and no
`access:write`; the browser left `/pair`. Network access remained disabled.
Private one-time credential files were removed after the proof.

T3's original preview automation client explicitly disconnected during open.
The successful proof therefore used a separate diagnostic browser and does not
establish authentication of that original T3 view. Reconnect its desktop preview
before verifying that view; never report it as paired based on another browser.
No study request or unrelated chat was submitted during this fix.

The live backend was not restarted: its existing pairing behavior worked as-is.
The corrected auth descriptor takes effect when the updated server starts.
Browser diagnostics are not native desktop end-to-end or packaged release
acceptance. UI dependency `c0bd23bf9` is committed locally and pinned by the root integration.
Neither commit is pushed or merged. This is a local development fix, not a
published release.
