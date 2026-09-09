"""Control-plane checks without starting Moodle, a VM, or any container."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import socket
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import lab


class LabTests(unittest.TestCase):
    def test_refuses_shared_or_symlink_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shared = root / 'shared'
            shared.mkdir(mode=0o755)
            with self.assertRaises(RuntimeError):
                lab.private_directory(shared)
            link = root / 'link'
            link.symlink_to(shared)
            with self.assertRaises(RuntimeError):
                lab.private_directory(link)

    def test_reset_requires_confirmation_before_fixture(self):
        fixture = Mock()
        with self.assertRaises(RuntimeError):
            lab.dispatch({'action': 'reset'}, {'fixture': fixture})
        fixture.assert_not_called()

    def test_reset_updates_manifest_and_probes_new_contents(self):
        manifest = {'courseUrl': 'http://127.0.0.1:5555/course/view.php?id=42'}
        fixture = Mock(return_value=SimpleNamespace(returncode=0, stdout=json.dumps(manifest)))
        context = dict(fixture=fixture, manifest={}, base='http://127.0.0.1:5555', passwords={})
        with patch.object(lab, 'run_probe', return_value={'ok': True}) as probe:
            result = lab.dispatch({'action': 'reset', 'confirm': 'reset-synthetic-course-only'}, context)
            self.assertTrue(result['ok'])
            self.assertEqual(probe.call_args.args[0]['manifest'], manifest)

    def test_status_has_no_credentials_and_admin_handoff_refused(self):
        context = dict(base='http://127.0.0.1:5555', manifest={}, passwords={'windows': 'synthetic-secret'})
        self.assertNotIn('synthetic-secret', json.dumps(lab.dispatch({'action': 'status'}, context)))
        with self.assertRaises(RuntimeError):
            lab.dispatch({'action': 'credentials', 'lane': 'admin'}, context)
        self.assertEqual(lab.dispatch({'action': 'credentials', 'lane': 'windows'}, context)['username'],
                         'sb-lab-windows')

    def test_bounded_socket_message(self):
        sender, receiver = socket.socketpair()
        try:
            sender.sendall(b'x' * (lab.MAX_MESSAGE + 1))
            with self.assertRaises(RuntimeError):
                lab.receive(receiver)
        finally:
            sender.close()
            receiver.close()

    def test_actual_private_control_socket_and_cleanup(self):
        with tempfile.TemporaryDirectory() as directory, ThreadPoolExecutor(max_workers=1) as pool:
            # Deliberately exceed the usual 108-byte UNIX socket pathname limit.
            state = Path(directory) / ('long-state-directory-' * 6)
            def client():
                deadline = time.monotonic() + 3
                while not (state / 'control.sock').exists():
                    if time.monotonic() > deadline:
                        raise AssertionError('Control socket did not start')
                    time.sleep(0.01)
                status = lab.control('status', state=state)
                stopping = lab.control('stop', state=state)
                return status, stopping

            def fake_run(archive, on_ready):
                future = pool.submit(client)
                on_ready({'ok': True}, 'http://127.0.0.1:5555', {}, {'windows': 'never-print'}, Mock())
                status, stopped = future.result(timeout=3)
                self.assertEqual(status['state'], 'ready')
                self.assertEqual(stopped['state'], 'stopping')
                return {'ok': True}

            with patch.object(lab, 'run', side_effect=fake_run), patch('builtins.print') as output:
                self.assertTrue(lab.serve(Path('/unused'), state)['ok'])
                self.assertNotIn('never-print', str(output.call_args_list))
            self.assertFalse((state / 'control.sock').exists())
            self.assertEqual(os.stat(state).st_mode & 0o777, 0o700)


if __name__ == '__main__':
    unittest.main()
