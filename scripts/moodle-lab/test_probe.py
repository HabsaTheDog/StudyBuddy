"""Probe contract tests using synthetic HTTP, not Moodle or packaged-app acceptance."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import unittest
from urllib.parse import parse_qs

from probe import LoginForm, MoodleClient, admin_denied, run_probe


DATA = b'SB-LAB-NOTES-V1 synthetic content'


class FakeMoodle(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send(self, code, body, cookie=None):
        self.send_response(code)
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        values = parse_qs(self.rfile.read(int(self.headers.get('Content-Length', 0))).decode())
        valid = values.get('password') == ['synthetic-test-password-for-unit-tests']
        self.send(200, b'Logged in' if valid else b'Invalid login', 'session=ok; Path=/' if valid else None)

    def do_GET(self):
        if self.path.startswith('/login/') or 'session=ok' not in self.headers.get('Cookie', ''):
            self.send(200, b'<input name="logintoken" value="synthetic-token">')
        elif self.path.startswith('/course/'):
            self.send(200, b'Study Buddy Synthetic Test Course')
        elif self.path.startswith('/mod/page/'):
            self.send(200, b'SB-LAB-PAGE-V1 36 N')
        elif self.path.startswith('/admin/'):
            self.send(403, b'Permission denied')
        else:
            self.send(200, DATA)


class ProbeTests(unittest.TestCase):
    def test_admin_denial_requires_real_permission_error_not_missing_page(self):
        denied = b'<a href="https://docs.moodle.org/501/en/error/admin/accessdenied">More information</a>'
        self.assertTrue(admin_denied(404, denied))
        self.assertTrue(admin_denied(403, b'Forbidden'))
        self.assertFalse(admin_denied(404, b'Page not found'))
        self.assertFalse(admin_denied(404, b'error/admin/sectionerror'))
        self.assertFalse(admin_denied(500, denied))
        self.assertFalse(admin_denied(200, b'User administration'))

    def test_rejects_http_outside_explicit_loopback_test(self):
        for url, local in [('http://127.0.0.1', False), ('http://192.168.1.9', True), ('http://example.com', True)]:
            with self.assertRaises(ValueError):
                MoodleClient(url, local)

    def test_rejects_embedded_credentials(self):
        with self.assertRaises(ValueError):
            MoodleClient('https://username:password@example.com')

    def test_refuses_off_origin_manifest_before_request(self):
        client = MoodleClient('https://example.com')
        with self.assertRaises(ValueError):
            client.get('https://other.example.com/file')

    def test_parses_only_login_token(self):
        parser = LoginForm()
        parser.feed('<input name="password" value="ignore"><input value="fixture-token" name="logintoken">')
        self.assertEqual(parser.token, 'fixture-token')

    def test_real_http_cookie_flow_and_corrupted_file_detection(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), FakeMoodle)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            base = f'http://127.0.0.1:{server.server_port}'
            config = {
                'baseUrl': base, 'isolatedLoopbackTest': True,
                'passwords': {lane: 'synthetic-test-password-for-unit-tests' for lane in ('windows', 'fedora')},
                'manifest': {'courseUrl': base + '/course/view.php', 'pageUrl': base + '/mod/page/view.php',
                             'files': [{'name': 'notes.txt', 'url': base + '/pluginfile.php',
                                        'sha256': hashlib.sha256(DATA).hexdigest()}]},
            }
            result = run_probe(config)
            self.assertTrue(result['ok'], result)
            self.assertNotIn('synthetic-test-password', json.dumps(result))
            config['manifest']['files'][0]['sha256'] = '0' * 64
            result = run_probe(config)
            self.assertFalse(result['ok'])
            self.assertFalse(result['checks']['windows_notes.txt'])
            self.assertFalse(result['checks']['fedora_notes.txt'])
        finally:
            server.shutdown()
            worker.join(timeout=5)
            server.server_close()


if __name__ == '__main__':
    unittest.main()
