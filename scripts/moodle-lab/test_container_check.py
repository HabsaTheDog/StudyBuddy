"""Verify preflight fails before touching Podman when safety inputs are wrong."""
from pathlib import Path
import json
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import container_check


class ContainerPreflightTests(unittest.TestCase):
    def test_diagnostics_strip_messages_and_arguments(self):
        fields = dict(stage='course', errorClass='coding_exception', file='data_generator.php', line=400)
        result = SimpleNamespace(stderr=json.dumps({**fields, 'message': 'private-password', 'args': ['secret']}))
        self.assertEqual(container_check.fixture_diagnostic(result), fields)

    def test_diagnostics_refuse_raw_output(self):
        for stderr in ('private-password', '{}', '[]', '{"stage":"private-password"}'):
            self.assertEqual(container_check.fixture_diagnostic(SimpleNamespace(stderr=stderr)), {'stage': 'unknown'})

    def test_low_memory_refuses_before_archive_or_container_access(self):
        with patch.object(container_check, 'available_memory', return_value=8 * 1024**3), \
             patch.object(container_check, 'command') as command:
            with self.assertRaisesRegex(RuntimeError, 'Insufficient host reserve'):
                container_check.run(Path('/nonexistent-test-archive'))
            command.assert_not_called()

    def test_bad_archive_refuses_before_container_access(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'synthetic.tgz'
            archive.write_bytes(b'not the pinned Moodle archive')
            with patch.object(container_check, 'available_memory', return_value=12 * 1024**3), \
                 patch.object(container_check, 'command') as command:
                with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
                    container_check.run(archive)
                command.assert_not_called()


if __name__ == '__main__':
    unittest.main()
