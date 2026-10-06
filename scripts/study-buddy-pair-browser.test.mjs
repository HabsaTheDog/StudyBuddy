import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createBrowserPairing, parsePairingArgs } from './study-buddy-pair-browser.mjs';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'study-buddy-pair-'));
  const baseDir = path.join(root, 'state');
  mkdirSync(path.join(baseDir, 'dev'), { recursive: true });
  mkdirSync(path.join(root, 't3code-fork/apps/server/dist'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'study-buddy' }));
  writeFileSync(path.join(baseDir, 'dev/state.sqlite'), 'existing fixture');
  writeFileSync(path.join(root, 't3code-fork/apps/server/dist/bin.mjs'), '// fixture');
  const grant = { id: 'pair-1', credential: 'one-time-fixture', expiresAt: new Date(Date.now() + 300000).toISOString(), pairUrl: 'http://127.0.0.1:5853/pair#token=one-time-fixture' };
  const options = { 'base-dir': baseDir, 'dev-url': 'http://127.0.0.1:5853/', 'ui-url': 'http://127.0.0.1:5853/pair', out: path.join(root, 'private/pairing.json') };
  const fetchImpl = async () => ({ ok: true, text: async () => '<title>Study Buddy (Dev)</title>' });
  return { root, baseDir, options, grant, fetchImpl, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('issues a fresh standard pairing through explicit matching dev runtime and keeps secret in owner-only file', async () => {
  const f = fixture();
  try {
    let invocation;
    const result = await createBrowserPairing(f.options, { root: f.root, fetchImpl: f.fetchImpl, run: (binary, args, settings) => { invocation = { binary, args, settings }; return { status: 0, stdout: JSON.stringify(f.grant) }; } });
    assert.deepEqual(JSON.parse(readFileSync(f.options.out, 'utf8')), f.grant);
    assert.equal(statSync(f.options.out).mode & 0o777, 0o600);
    assert.ok(!JSON.stringify(result).includes(f.grant.credential));
    assert.ok(invocation.args.includes('--dev-url'));
    assert.ok(invocation.args.includes(f.baseDir));
    assert.equal(invocation.settings.shell, undefined);
    assert.ok(!Object.keys(invocation.settings.env).some(key => /^(T3CODE_|VITE_|STUDY_BUDDY_)/u.test(key)));
    assert.equal(result.networkAccessChanged, false);
    assert.match(readFileSync(path.join(f.baseDir, 'dev/state.sqlite'), 'utf8'), /existing fixture/u);
  } finally { f.cleanup(); }
});

test('check mode never issues a credential or writes an output', async () => {
  const f = fixture();
  try {
    const result = await createBrowserPairing({ ...f.options, check: true }, { root: f.root, fetchImpl: f.fetchImpl, run: () => { throw Error('must not issue'); } });
    assert.equal(result.checked, true);
    assert.equal(existsSync(f.options.out), false);
  } finally { f.cleanup(); }
});

test('existing output, missing database, wrong app and nonlocal URLs never reach credential issuance', async () => {
  const f = fixture();
  try {
    const dependencies = { root: f.root, fetchImpl: f.fetchImpl, run: () => { throw Error('must not issue'); } };
    mkdirSync(path.dirname(f.options.out)); writeFileSync(f.options.out, 'protected');
    await assert.rejects(createBrowserPairing(f.options, dependencies), /EEXIST/u);
    assert.equal(readFileSync(f.options.out, 'utf8'), 'protected');
    await assert.rejects(createBrowserPairing({ ...f.options, 'dev-url': undefined }, dependencies), /database does not exist/u);
    for (const url of ['http://example.com/', 'http://127.0.0.1:5853/?token=secret', 'http://secret@127.0.0.1:5853/', 'http://127.0.0.1:5853/api/auth']) {
      await assert.rejects(createBrowserPairing({ ...f.options, 'ui-url': url }, dependencies));
    }
    writeFileSync(path.join(f.root, 'package.json'), '{"name":"t3"}');
    await assert.rejects(createBrowserPairing(f.options, dependencies), /verified Study Buddy/u);
  } finally { f.cleanup(); }
});

test('CLI failure removes its reserved output without exposing returned secrets', async () => {
  const f = fixture();
  try {
    await assert.rejects(createBrowserPairing(f.options, { root: f.root, fetchImpl: f.fetchImpl, run: () => ({ status: 1, stderr: 'private-existing-secret' }) }), error => !error.message.includes('private-existing-secret'));
    assert.equal(existsSync(f.options.out), false);
  } finally { f.cleanup(); }
});

test('unknown flags, absent explicit runtime and mismatched development origins are rejected', async () => {
  assert.throws(() => parsePairingArgs([]));
  assert.throws(() => parsePairingArgs(['--base-dir', '/tmp', '--ui-url', 'http://127.0.0.1/', '--session-token', 'secret']));
  const f = fixture();
  try {
    await assert.rejects(createBrowserPairing({ ...f.options, 'dev-url': 'http://127.0.0.1:9999/' }, { root: f.root, fetchImpl: f.fetchImpl }), /match the browser/u);
  } finally { f.cleanup(); }
});

test('symlinked database, state directory, output ancestor and independent-root aliases remain isolated', async () => {
  const f = fixture();
  try {
    const independent = path.join(f.root, 'independent-t3');
    mkdirSync(independent); writeFileSync(path.join(independent, 'state.sqlite'), 'independent original');
    const alias = path.join(f.root, 'independent-alias'); symlinkSync(independent, alias);
    const dependencies = { root: f.root, fetchImpl: f.fetchImpl, independentRoots: [alias], run: () => { throw Error('must not issue'); } };
    const database = path.join(f.baseDir, 'dev/state.sqlite');
    unlinkSync(database); symlinkSync(path.join(independent, 'state.sqlite'), database);
    await assert.rejects(createBrowserPairing(f.options, dependencies), /Independent T3 Code/u);
    rmSync(path.join(f.baseDir, 'dev'), { recursive: true }); symlinkSync(independent, path.join(f.baseDir, 'dev'));
    await assert.rejects(createBrowserPairing(f.options, dependencies), /Independent T3 Code/u);
    unlinkSync(path.join(f.baseDir, 'dev')); mkdirSync(path.join(f.baseDir, 'dev')); writeFileSync(database, 'existing fixture');
    const outputAlias = path.join(f.root, 'output-alias'); symlinkSync(independent, outputAlias);
    await assert.rejects(createBrowserPairing({ ...f.options, out: path.join(outputAlias, 'new/pair.json') }, dependencies), /Independent T3 Code/u);
    assert.equal(readFileSync(path.join(independent, 'state.sqlite'), 'utf8'), 'independent original');
    assert.equal(existsSync(path.join(independent, 'new')), false);
  } finally { f.cleanup(); }
});

test('auth initialization cannot follow a secrets directory or signing key into independent T3 state', async () => {
  const f = fixture();
  try {
    const independent = path.join(f.root, 'independent-t3');
    mkdirSync(independent, { mode: 0o755 });
    const key = path.join(independent, 'server-signing-key.bin');
    writeFileSync(key, 'independent signing key');
    const dependencies = { root: f.root, fetchImpl: f.fetchImpl, independentRoots: [independent], run: () => { throw Error('must not issue'); } };
    const secrets = path.join(f.baseDir, 'dev/secrets');
    symlinkSync(independent, secrets);
    await assert.rejects(createBrowserPairing(f.options, dependencies), /Independent T3 Code/u);
    unlinkSync(secrets); mkdirSync(secrets);
    symlinkSync(key, path.join(secrets, 'server-signing-key.bin'));
    await assert.rejects(createBrowserPairing(f.options, dependencies), /Independent T3 Code/u);
    assert.equal(statSync(independent).mode & 0o777, 0o755);
    assert.equal(readFileSync(key, 'utf8'), 'independent signing key');
    assert.equal(existsSync(f.options.out), false);
  } finally { f.cleanup(); }
});
