import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));

test('workflow package retains executable entry points and its locked dependency identity', () => {
  assert.equal(pkg.name, 'study-buddy');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.version, lock.packages[''].version);
  assert.deepEqual(pkg.dependencies, lock.packages[''].dependencies);
  assert.deepEqual(pkg.devDependencies, lock.packages[''].devDependencies);
  for (const name of ['moodle:agent', 'moodle:watchdog', 'web-layout:agent', 'interactive-study-guide']) {
    const match = pkg.scripts?.[name]?.match(/^tsx\s+(\S+)/u);
    assert.ok(match, `${name} must remain executable by the desktop workflow adapter`);
    assert.ok(existsSync(fileURLToPath(new URL(match[1], root))), `${name} entry must exist`);
  }
});

test('cross-platform workflow CI provisions the pinned editor used by model-policy parity tests', () => {
  const workflow = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8');
  const verify = workflow.slice(workflow.indexOf('  verify:'), workflow.indexOf('  repository-policy:'));
  const testStep = verify.indexOf('run: npm test');
  const setup = verify.indexOf('uses: voidzero-dev/setup-vp@');
  assert.ok(testStep > setup && setup >= 0, 'editor dependencies must be installed before workflow tests');
  assert.match(verify.slice(0, setup), /submodules: true/u, 'checkout must include the pinned editor source');
  assert.match(verify.slice(setup, testStep), /working-directory: t3code-fork[\s\S]*run-install: true/u);
  const editorSetup = verify.slice(setup, verify.indexOf('      - uses:', setup));
  assert.match(editorSetup, /node-manager: false/u, 'editor installation must retain the root workflow Node runtime');
  assert.doesNotMatch(editorSetup, /node-version(?:-file)?:/u, 'disabled Node management cannot request another runtime');
});
