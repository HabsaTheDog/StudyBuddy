"""On-demand, loopback-only Moodle lab. Run serve in a dedicated terminal.

Server acceptance completes before the private control socket becomes ready.
No daemon, autostart, public endpoint, VM change or persistent student secrets.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import signal
import socket
import stat
import sys

from container_check import PreflightError, run
from probe import run_probe


STATE = Path(__file__).resolve().parents[2] / 'study-buddy-data' / 'moodle-lab'
MAX_MESSAGE = 32768


def private_directory(path):
    if path.is_symlink():
        raise RuntimeError('Lab state must not be a symlink')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise RuntimeError('Lab state must be owned by this user with mode 0700')


def receive(stream):
    data = bytearray()
    while not data.endswith(b'\n'):
        chunk = stream.recv(min(4096, MAX_MESSAGE + 1 - len(data)))
        if not chunk or len(data) + len(chunk) > MAX_MESSAGE:
            raise RuntimeError('Incomplete or oversized control message')
        data.extend(chunk)
    return json.loads(data)


def dispatch(request, context):
    action = request.get('action')
    if action == 'status':
        return {'ok': True, 'state': 'ready', 'baseUrl': context['base'],
                'scope': 'local-server-only', 'manifest': context['manifest']}
    if action == 'probe':
        return run_probe({'baseUrl': context['base'], 'isolatedLoopbackTest': True,
                          'manifest': context['manifest'], 'passwords': context['passwords']})
    if action == 'reset':
        if request.get('confirm') != 'reset-synthetic-course-only':
            raise RuntimeError('Explicit synthetic-course reset confirmation required')
        result = context['fixture']('reset', confirm='reset-synthetic-course-only')
        if result.returncode:
            raise RuntimeError('Synthetic reset failed')
        context['manifest'] = json.loads(result.stdout)
        return dispatch({'action': 'probe'}, context)
    if action == 'credentials':
        lane = request.get('lane')
        if lane not in ('windows', 'fedora'):
            raise RuntimeError('Expected windows or fedora student lane')
        # Only over a same-user, owner-only UNIX socket. Never expose admin/DB secrets.
        return {'ok': True, 'baseUrl': context['base'], 'username': 'sb-lab-' + lane,
                'password': context['passwords'][lane]}
    if action == 'stop':
        return {'ok': True, 'state': 'stopping'}
    raise RuntimeError('Unknown lab action')


def serve(archive, state=STATE):
    private_directory(state)
    # flock prevents two launchers from deleting each other's socket/resources.
    lock_fd = os.open(state / 'service.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('A local Moodle lab is already starting or running') from None
        # AF_UNIX paths are short on Linux. /proc/self/fd addresses our verified
        # private directory without binding a socket outside the repo state tree.
        directory_fd = os.open(state, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        endpoint = f'/proc/self/fd/{directory_fd}/control.sock'
        socket_path = state / 'control.sock'
        previous_handlers = {}

        def interrupted(_signum, _frame):
            raise KeyboardInterrupt

        def ready(receipt, base, manifest, passwords, fixture):
            context = dict(base=base, manifest=manifest, passwords=passwords, fixture=fixture)
            with socket.socket(socket.AF_UNIX) as server:
                server.bind(endpoint)
                socket_path.chmod(0o600)
                server.listen(1)
                print(json.dumps({**receipt, 'state': 'ready', 'baseUrl': base}), flush=True)
                while True:
                    connection, _ = server.accept()
                    with connection:
                        connection.settimeout(5)
                        stopping = False
                        try:
                            request = receive(connection)
                            response = dispatch(request, context)
                            stopping = request.get('action') == 'stop'
                        except Exception as error:
                            response = {'ok': False, 'errorClass': type(error).__name__}
                        try:
                            connection.sendall(json.dumps(response).encode() + b'\n')
                        except OSError:
                            pass
                    if stopping:
                        return

        try:
            if socket_path.exists() or socket_path.is_symlink():
                if not stat.S_ISSOCK(socket_path.lstat().st_mode):
                    raise RuntimeError('Unexpected lab control path; refusing replacement')
                socket_path.unlink()  # stale socket, only after exclusive lock
            for sig in (signal.SIGTERM, signal.SIGHUP):
                previous_handlers[sig] = signal.signal(sig, interrupted)
            return run(archive, on_ready=ready)
        except KeyboardInterrupt:
            return {'ok': True, 'state': 'stopped'}
        finally:
            if socket_path.exists() and stat.S_ISSOCK(socket_path.lstat().st_mode):
                socket_path.unlink()
            os.close(directory_fd)
            for sig, handler in previous_handlers.items():
                signal.signal(sig, handler)


def control(action, *, lane=None, confirm=None, state=STATE):
    private_directory(state)
    directory_fd = os.open(state, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        with socket.socket(socket.AF_UNIX) as client:
            client.settimeout(240)
            client.connect(f'/proc/self/fd/{directory_fd}/control.sock')
            client.sendall(json.dumps({'action': action, 'lane': lane, 'confirm': confirm}).encode() + b'\n')
            return receive(client)
    finally:
        os.close(directory_fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('serve').add_argument('--archive', required=True, type=Path)
    for action in ('status', 'probe', 'stop'):
        sub.add_parser(action)
    sub.add_parser('reset').add_argument('--confirm', required=True,
        choices=['reset-synthetic-course-only'])
    sub.add_parser('credentials').add_argument('--lane', required=True, choices=['windows', 'fedora'])
    args = parser.parse_args()
    if args.action == 'credentials' and not sys.stdout.isatty():
        parser.error('Student credentials may only be displayed in your private terminal, not redirected/logged')
    try:
        result = serve(args.archive) if args.action == 'serve' else control(
            args.action, lane=getattr(args, 'lane', None), confirm=getattr(args, 'confirm', None))
    except PreflightError as error:
        result = {'ok': False, 'state': 'blocked', 'reason': str(error)}
    except (FileNotFoundError, ConnectionRefusedError):
        result = {'ok': False, 'state': 'unavailable',
                  'hint': 'No ready local service. Check the serve terminal; status is available after acceptance passes.'}
    except Exception as error:
        # No raw errors, payloads, subprocess output or secrets in agent receipts.
        result = {'ok': False, 'errorClass': type(error).__name__,
                  'hint': 'Check available RAM (9 GiB minimum), pinned inputs and the local serve terminal.'}
    print(json.dumps(result))
    return 0 if result.get('ok') else 1


if __name__ == '__main__':
    raise SystemExit(main())
