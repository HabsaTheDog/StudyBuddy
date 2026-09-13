# Synthetic Moodle fixture tooling

Status, 2026-09-10: **real Moodle server acceptance passed** (19 checks),
including live service controls and cleanup; 16 lightweight tests pass.
**Packaged-app integration is still pending.** See [checkpoint](../../docs/moodle-test-service.md).
The owner chose local-only development containers, not Proxmox or a tunnel.

## Verified inputs

The official Moodle 5.1.6 archive was downloaded and matched its official
SHA-256: `52ef3f988831c6759e1d1d8552248eb3da832b658123ede548d65379de46a6e5`.

- [Moodle archive](https://download.moodle.org/download.php/direct/stable501/moodle-5.1.6.tgz)
- [Official checksum](https://download.moodle.org/download.php/direct/stable501/moodle-5.1.6.tgz.sha256)

The test runner pins PHP and PostgreSQL image digests. Obtain them with `podman
pull` using `PHP_IMAGE` and `DB_IMAGE` in `container_check.py`; they were already
downloaded in the initial workstation preparation. Nothing is installed into
the personal Study Buddy app or its data directories.

## Repeatable server acceptance

On a rootless Podman host with at least 9 GiB MemAvailable:

```sh
python3 scripts/moodle-lab/container_check.py --archive /path/to/moodle-5.1.6.tgz
```

The 9 GiB gate reserves 1 GiB for tests and leaves 8 GiB for the owner. It runs
only two bounded containers (512/256 MiB), on a uniquely named internal network,
with a loopback-only HTTP listener. Image pulls are not implicit. It verifies
the source archive before extracting it into a private temporary directory.

The runner bootstraps a real Moodle database, seeds the course/accounts, checks
anonymous denial, successful student logins, exact protected-file hashes,
known page content, admin denial and invalid-password rejection, then exercises
reset refusal and successful deterministic re-seeding. It removes only its own
recorded container IDs, associated anonymous volumes, internal network and
temporary fixture/credential files. A cleanup failure is an error, not a pass.

The JSON result contains named checks and credential-safe failure diagnostics;
stderr reports named phases and elapsed seconds during startup. The
runner suppresses raw subprocess output so credentials cannot enter receipts.
Diagnostics omit exception messages/arguments and raw HTTP response contents.
It does not run AI generation or test the packaged app.

## On-demand local service

Run in a dedicated terminal, from the repository root:

```sh
python3 scripts/moodle-lab/lab.py serve --archive study-buddy-data/moodle-lab/cache/moodle-5.1.6.tgz
```

This uses the same acceptance runner above, then keeps the verified service
alive until stopped. It prints a loopback URL only after server acceptance
passes. If startup is refused or any check fails, it does not advertise readiness.
Initial bootstrap/acceptance took roughly 75 seconds on the verified workstation.
In another terminal:

```sh
python3 scripts/moodle-lab/lab.py status
python3 scripts/moodle-lab/lab.py probe
python3 scripts/moodle-lab/lab.py reset --confirm reset-synthetic-course-only
python3 scripts/moodle-lab/lab.py stop
```

Status includes synthetic fixture URLs and hashes, never passwords. Reset
recreates only the synthetic course and immediately probes it again. Stop
acknowledges the request; wait for the serve process to exit successfully to
confirm cleanup. Ctrl+C and SIGTERM also clean up. A host crash/SIGKILL can leave
resources behind; never use broad Podman prune to recover them.

The private UNIX control socket lives under ignored
`study-buddy-data/moodle-lab/` (0700 directory, 0600 socket). Student secrets
remain in the foreground process rather than a saved credentials file. To see
a student login in **your own private terminal**, not agent logs:

```sh
python3 scripts/moodle-lab/lab.py credentials --lane windows
```

Use `fedora` for the other student. Redirected credential display is refused.
These are synthetic Moodle accounts, not ChatGPT accounts or API keys. Safe
automatic guest credential entry is still pending.

The app's production source policy rejects this HTTP/local URL. The service
is available for local server development, but cannot yet be used as a source
by the unchanged published Windows/Fedora app. A separate development-only
integration design and tests are needed; do not disable app security or claim
server-only checks satisfy desktop release acceptance.

## Internal fixture operations

`bootstrap.php` is one-time setup for a dedicated empty source tree, data
directory and `sb_moodle_lab` PostgreSQL database. It refuses to overwrite an
existing `config.php`. Its JSON stdin carries instance ID, base URL and newly
generated database/admin passwords; credentials never go in OS command-line
arguments. It invokes Moodle's official CLI installer and disables outgoing
email, public self-registration and web services. Keep the origin loopback-only;
the local test server is not a production webserver.

`fixture.php /path/to/moodle/config.php` accepts JSON on stdin:

- `operation`: `seed`, `inspect` or `reset`;
- `instance`: the installation's exact non-secret 32-hex identity marker;
- `passwords`: per-lane `windows` and `fedora` passwords (not needed for inspect);
- reset additionally requires `confirm: "reset-synthetic-course-only"`.

Never paste a real invocation with passwords into chat. Generate passwords in
the local service process. The desktop secret-entry path remains to be
implemented and tested; the CLI-only display is not that capability.

Reset deletes/recreates only `SB-LAB-001`; it refuses a foreign course marker,
wrong instance, missing confirmation or additional non-fixture courses. It
does not drop the database or reset users' unrelated accounts. Student records
must bear the fixture marker and must not be site administrators. The script
never creates or submits a quiz attempt.

`probe.py` accepts the fixture manifest, matching `baseUrl` and student passwords
on stdin. HTTPS is required except an explicitly selected `127.0.0.1` container
self-test. Cross-origin requests/redirects are rejected. This exception lives
only in the test client and does not weaken Study Buddy's source URL policy.

## Lightweight contract tests

```sh
python3 -m unittest discover -s scripts/moodle-lab -p 'test_*.py' -v
```

These use a fake HTTP server and mocks to test the checker itself, including
corrupt-file detection and refusal before container access. Passing them is not
evidence that the actual Moodle deployment or installed desktop app works.
