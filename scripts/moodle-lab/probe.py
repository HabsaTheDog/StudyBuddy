"""Read-only real Moodle HTTP smoke probe. Credentials enter via stdin, never argv.

Server integration only: this cannot stand in for an installed Study Buddy test.
"""
import hashlib
import http.cookiejar
from html.parser import HTMLParser
import json
import sys
from urllib.error import HTTPError
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPCookieProcessor, ProxyHandler, Request, build_opener


class ProbeError(ValueError):
    """Only locally authored messages, never remote response content or URLs."""


def admin_denied(status, content):
    # Moodle may render exceptions with HTTP 404. A generic missing page is
    # not authorization evidence: require its specific access-denied error link.
    return status == 403 or (status in (200, 404) and b'error/admin/accessdenied' in content.lower())


class LoginForm(HTMLParser):
    def __init__(self):
        super().__init__()
        self.token = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'input' and attrs.get('name') == 'logintoken':
            self.token = attrs.get('value')


def origin(url):
    parsed = urlsplit(url)
    if parsed.username or parsed.password or parsed.fragment:
        raise ProbeError('Invalid fixture URL')
    return parsed.scheme, parsed.hostname, parsed.port


class SameOriginRedirect(HTTPRedirectHandler):
    def __init__(self, expected):
        self.expected = expected
        self.routes = []

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if origin(newurl) != self.expected:
            raise ProbeError('Cross-origin redirect refused')
        route = {'/login/index.php': 'login', '/admin/index.php': 'admin', '/': 'home',
                 '/my/': 'dashboard'}.get(urlsplit(newurl).path, 'other')
        self.routes = (self.routes + [route])[-8:]
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class MoodleClient:
    def __init__(self, base, local_test=False):
        self.expected = origin(base)
        if self.expected[0] != 'https':
            if not (local_test and self.expected[0] == 'http' and self.expected[1] == '127.0.0.1'):
                raise ProbeError('HTTPS required outside isolated loopback server tests')
        self.base = base.rstrip('/') + '/'
        self.redirects = SameOriginRedirect(self.expected)
        self.opener = build_opener(ProxyHandler({}), self.redirects,
                                  HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def get(self, path, data=None):
        url = urljoin(self.base, path)
        if origin(url) != self.expected:
            raise ProbeError('Fixture target origin mismatch')
        payload = urlencode(data).encode() if data is not None else None
        request = Request(url, data=payload, headers={'User-Agent': 'StudyBuddy-Moodle-Lab/1'})
        try:
            response = self.opener.open(request, timeout=15)
        except HTTPError as error:
            response = error
        with response:
            content = response.read(2 * 1024 * 1024 + 1)
            if len(content) > 2 * 1024 * 1024:
                raise ProbeError('Oversized fixture response')
            return response.status, response.url, content

    def login(self, username, password):
        status, _, page = self.get('login/index.php')
        parser = LoginForm()
        parser.feed(page.decode('utf-8'))
        if status != 200 or not parser.token:
            indicators = [marker for marker in ('wwwroot', 'reverseproxy', 'maintenance',
                'Database connection failed', 'Coding error detected', 'HTTPS', 'Page not found')
                if marker.encode() in page]
            raise ProbeError(f'Expected Moodle login form: HTTP {status}; indicators={indicators}; '
                             f'redirectRoutes={self.redirects.routes}')
        return self.get('login/index.php', {
            'username': username, 'password': password, 'logintoken': parser.token,
        })


def run_probe(config):
    base = config['baseUrl']
    manifest = config['manifest']
    local_test = config.get('isolatedLoopbackTest', False) is True
    checks = {}
    def denied(status, content):
        parser = LoginForm()
        parser.feed(content.decode('utf-8', errors='replace'))
        return status in (401, 403) or (status == 200 and bool(parser.token))

    anonymous = MoodleClient(base, local_test)
    for file in manifest['files']:
        status, _, content = anonymous.get(file['url'])
        checks['anonymous_denied_' + file['name']] = denied(status, content)
    for lane in ('windows', 'fedora'):
        username = 'sb-lab-' + lane
        client = MoodleClient(base, local_test)
        client.login(username, config['passwords'][lane])
        status, _, content = client.get(manifest['courseUrl'])
        checks[lane + '_course'] = status == 200 and b'Study Buddy Synthetic Test Course' in content
        status, _, content = client.get(manifest['pageUrl'])
        checks[lane + '_page'] = status == 200 and b'SB-LAB-PAGE-V1' in content and b'36 N' in content
        for file in manifest['files']:
            status, _, content = client.get(file['url'])
            checks[lane + '_' + file['name']] = status == 200 and hashlib.sha256(content).hexdigest() == file['sha256']
        status, _, content = client.get('admin/user.php')
        checks[lane + '_admin_denied'] = admin_denied(status, content)
    invalid = MoodleClient(base, local_test)
    invalid.login('sb-lab-windows', 'Deliberately-invalid-test-password')
    status, _, content = invalid.get(manifest['pageUrl'])
    checks['invalid_password_denied'] = denied(status, content) and b'SB-LAB-PAGE-V1' not in content
    return {'ok': all(checks.values()), 'scope': 'server-http-not-packaged-app', 'checks': checks}


if __name__ == '__main__':
    try:
        config = json.loads(sys.stdin.read(65537))
        result = run_probe(config)
        print(json.dumps(result))
        sys.exit(0 if result['ok'] else 1)
    except Exception:
        # No exception details, request bodies, cookies, tokens or credentials in evidence.
        print(json.dumps({'ok': False, 'error': 'fixture_probe_failed'}))
        sys.exit(1)
