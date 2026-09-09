"""Disposable real-Moodle fixture acceptance, not installed-app release acceptance.

Uses pre-pulled pinned images, a verified Moodle archive, private synthetic
credentials and an internal rootless Podman network. No host app changes.
"""
import argparse
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import secrets
import shutil
import subprocess
import tarfile
import tempfile
import time

from probe import run_probe


SOURCE_SHA256 = '52ef3f988831c6759e1d1d8552248eb3da832b658123ede548d65379de46a6e5'
PHP_IMAGE = 'docker.io/moodlehq/moodle-php-apache@sha256:29ab1ae9e0ad5298dee855b89a06778385ca5dc5e3cefff168e0ec9b392f2081'
DB_IMAGE = 'docker.io/library/postgres@sha256:1938c16e9d2f10a6a3623b344b64ae8d45f407f2c5f34f0979468bb689b9227a'
SCRIPTS = Path(__file__).resolve().parent


class PreflightError(RuntimeError):
    """Locally authored, credential-free startup refusal safe to display."""


def command(args, *, data=None, timeout=60, allow_failure=False):
    result = subprocess.run(args, input=data, capture_output=True, text=True, timeout=timeout)
    if result.returncode and not allow_failure:
        # Do not print raw subprocess diagnostics; they can include DB configuration.
        raise RuntimeError(f'{args[0]} operation failed, exit {result.returncode}')
    return result


def available_memory():
    for line in Path('/proc/meminfo').read_text().splitlines():
        if line.startswith('MemAvailable:'):
            return int(line.split()[1]) * 1024
    raise RuntimeError('Cannot verify memory reserve')


def run(archive, on_ready=None):
    available = available_memory()
    if available < 9 * 1024**3:
        raise PreflightError(f'Insufficient host reserve: {available / 1024**3:.1f} GiB available; '
                             'require 9 GiB (8 GiB owner reserve plus 1 GiB test allowance)')
    with archive.open('rb') as source:
        if hashlib.file_digest(source, 'sha256').hexdigest() != SOURCE_SHA256:
            raise PreflightError('Moodle 5.1.6 archive checksum mismatch')
    if command(['podman', 'info', '--format', '{{.Host.Security.Rootless}}']).stdout.strip() != 'true':
        raise RuntimeError('Rootless Podman required')
    for image in (PHP_IMAGE, DB_IMAGE):
        command(['podman', 'image', 'exists', image])

    # Names are generated here, never supplied by an operator or a repository file.
    name = 'sb-moodle-check-' + secrets.token_hex(6)
    containers = []
    network = None
    phase = 'prepare'
    checks = {}
    with ExitStack() as cleanup:
        work = Path(tempfile.mkdtemp(prefix='sb-moodle-check-'))
        try:
            with tarfile.open(archive) as package:
                package.extractall(work, filter='data')
            source = work / 'moodle'
            data_dir = work / 'data'
            data_dir.mkdir(mode=0o700)
            fixtures = work / 'fixtures'
            fixtures.mkdir()
            for filename in ('bootstrap.php', 'fixture.php'):
                shutil.copyfile(SCRIPTS / filename, fixtures / filename)
            db_password = 'Aa1!' + secrets.token_urlsafe(30)
            password_file = work / 'db-password'
            # The directory is 0700 on the host. PostgreSQL drops to its own
            # container UID before reading *_FILE, so the mounted file must be
            # readable there; the containing host directory remains private.
            password_file.touch(mode=0o644)
            password_file.write_text(db_password)
            password_file.chmod(0o644)
            passwords = {lane: 'Aa1!' + secrets.token_urlsafe(30) for lane in ('windows', 'fedora')}
            instance = secrets.token_hex(16)
            network = command(['podman', 'network', 'create', '--internal', name]).stdout.strip()
            phase = 'database'
            db = command(['podman', 'create', '--pull=never', '--name', name + '-db',
                '--network', name, '--network-alias', 'db', '--memory', '256m', '--memory-swap', '256m',
                '--cpus', '1', '--security-opt=no-new-privileges',
                '-v', f'{password_file}:/run/db-password:ro,Z',
                '-e', 'POSTGRES_DB=sb_moodle_lab', '-e', 'POSTGRES_USER=sb_moodle_lab',
                '-e', 'POSTGRES_PASSWORD_FILE=/run/db-password', DB_IMAGE]).stdout.strip()
            containers.append(db)
            command(['podman', 'start', db])
            for _ in range(30):
                ready = command(['podman', 'exec', db, 'pg_isready', '-U', 'sb_moodle_lab'], allow_failure=True)
                if ready.returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError('Database readiness timed out')
            phase = 'web'
            web = command(['podman', 'create', '--pull=never', '--name', name + '-web',
                '--network', name, '-p', '127.0.0.1::8080', '--memory', '512m', '--memory-swap', '512m',
                '--cpus', '1', '--security-opt=no-new-privileges', '--entrypoint', 'php',
                '-v', f'{source}:/app:Z', '-v', f'{data_dir}:/data:Z',
                '-v', f'{fixtures}:/lab:ro,Z', PHP_IMAGE,
                '-d', 'max_input_vars=5000', '-d', 'memory_limit=256M',
                '-S', '0.0.0.0:8080', '-t', '/app/public']).stdout.strip()
            containers.append(web)
            command(['podman', 'start', web])
            endpoint = command(['podman', 'port', web, '8080/tcp']).stdout.strip()
            if not endpoint.startswith('127.0.0.1:') or '\n' in endpoint:
                raise RuntimeError('Expected loopback-only test listener')
            base = 'http://' + endpoint
            phase = 'bootstrap'
            command(['podman', 'exec', '-i', web, 'php', '-d', 'max_input_vars=5000',
                '/lab/bootstrap.php', '/app', '/data'], data=json.dumps({
                    'instance': instance, 'baseUrl': base, 'isolatedLoopbackTest': True,
                    'databaseHost': 'db', 'databasePassword': db_password,
                    'adminPassword': 'Aa1!' + secrets.token_urlsafe(30),
                }), timeout=240)

            def fixture(operation, **extra):
                payload = {'operation': operation, 'instance': instance, 'passwords': passwords, **extra}
                return command(['podman', 'exec', '-i', web, 'php', '/lab/fixture.php', '/app/config.php'],
                               data=json.dumps(payload), allow_failure=True, timeout=120)

            phase = 'seed'
            seeded = fixture('seed')
            if seeded.returncode:
                raise RuntimeError('Fixture seed failed')
            manifest = json.loads(seeded.stdout)
            phase = 'http-probe'
            initial = run_probe({'baseUrl': base, 'isolatedLoopbackTest': True,
                                 'manifest': manifest, 'passwords': passwords})
            checks.update(initial['checks'])
            checks['wrong_instance_refused'] = fixture('reset', instance='0' * 32,
                confirm='reset-synthetic-course-only').returncode != 0
            checks['unconfirmed_reset_refused'] = fixture('reset').returncode != 0
            checks['duplicate_seed_refused'] = fixture('seed').returncode != 0
            checks['inspect_after_refusals'] = fixture('inspect').returncode == 0
            phase = 'reset'
            reset = fixture('reset', confirm='reset-synthetic-course-only')
            if reset.returncode:
                raise RuntimeError('Fixture reset failed')
            after = json.loads(reset.stdout)
            checks['reset_content_identical'] = [(f['name'], f['sha256']) for f in manifest['files']] == [
                (f['name'], f['sha256']) for f in after['files']]
            checks['http_after_reset'] = run_probe({'baseUrl': base, 'isolatedLoopbackTest': True,
                'manifest': after, 'passwords': passwords})['ok']
            receipt = {'ok': all(checks.values()), 'scope': 'real-moodle-server-not-packaged-app',
                       'moodle': '5.1.6', 'sourceSha256': SOURCE_SHA256, 'checks': checks}
            if receipt['ok'] and on_ready:
                # The foreground service owns these secrets only for its lifetime.
                # Its control socket is private; credentials never enter receipts.
                phase = 'serve'
                on_ready(receipt, base, after, passwords, fixture)
            return receipt
        except Exception as error:
            # Only locally authored phase/class names enter the receipt.
            return {'ok': False, 'phase': phase, 'errorClass': type(error).__name__, 'checks': checks}
        finally:
            cleanup_failed = False
            for container in reversed(containers):
                try:
                    cleanup_failed |= command(['podman', 'rm', '-f', '-v', container],
                                              allow_failure=True, timeout=30).returncode != 0
                except (OSError, subprocess.TimeoutExpired):
                    cleanup_failed = True
            if network:
                try:
                    cleanup_failed |= command(['podman', 'network', 'rm', network],
                                              allow_failure=True, timeout=30).returncode != 0
                except (OSError, subprocess.TimeoutExpired):
                    cleanup_failed = True
            if cleanup_failed:
                raise RuntimeError(f'Test-resource cleanup failed for {name}; private files retained at {work}')
            cleanup.callback(shutil.rmtree, work)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True, type=Path)
    args = parser.parse_args()
    try:
        result = run(args.archive)
        print(json.dumps(result))
        raise SystemExit(0 if result['ok'] else 1)
    except RuntimeError as error:
        # Preflight/cleanup errors above contain no credentials or subprocess output.
        print(json.dumps({'ok': False, 'blocked': str(error)}))
        raise SystemExit(1)
