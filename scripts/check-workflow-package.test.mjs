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
