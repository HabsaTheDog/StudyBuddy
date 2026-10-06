#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const usage = "Usage: node scripts/study-buddy-pair-browser.mjs --base-dir <Study Buddy state root> [--dev-url <running dev UI>] --ui-url <loopback Study Buddy UI> [--out <unused private JSON file>] [--check]";

export function parsePairingArgs(args) {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) return { help: true };
  const options = {};
  const values = new Set(["--base-dir", "--dev-url", "--ui-url", "--out"]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--check") { options.check = true; continue; }
    if (!values.has(flag) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error(usage);
    if (options[flag.slice(2)] !== undefined) throw new Error("Pairing flags must not be repeated.");
    options[flag.slice(2)] = args[++index];
  }
  if (!options["base-dir"] || !options["ui-url"]) throw new Error(usage);
  return options;
}

function loopbackUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new Error("Pair only an explicit loopback UI URL without credentials or tokens.");
  }
  if (url.pathname !== '/' && url.pathname !== '/pair') throw new Error("Select the Study Buddy UI root or /pair route.");
  return url;
}

function canonicalPath(value) {
  let current = path.resolve(value);
  const missing = [];
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Could not resolve pairing output ancestry.");
    missing.unshift(path.basename(current));
    current = parent;
  }
  return path.join(realpathSync(current), ...missing);
}

export async function createBrowserPairing(options, { root = projectRoot, fetchImpl = fetch, run = spawnSync, independentRoots = [path.join(os.homedir(), '.t3'), path.join(os.homedir(), '.config', 't3code')] } = {}) {
  const metadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (metadata.name !== 'study-buddy') throw new Error("Pairing must run from a verified Study Buddy application checkout.");
  const baseDir = realpathSync(path.resolve(options['base-dir']));
  const independentT3Roots = independentRoots.map(canonicalPath);
  const assertStudyBuddyPath = value => {
    if (independentT3Roots.some(candidate => value === candidate || value.startsWith(candidate + path.sep))) throw new Error("Independent T3 Code state must not be used for Study Buddy pairing.");
  };
  assertStudyBuddyPath(baseDir);
  const ui = loopbackUrl(options['ui-url']);
  const devUrl = options['dev-url'] ? loopbackUrl(options['dev-url']) : null;
  if (devUrl && devUrl.origin !== ui.origin) throw new Error("The selected development UI must match the browser pairing origin.");
  const selectedDatabase = path.join(baseDir, devUrl ? 'dev' : 'userdata', 'state.sqlite');
  if (!existsSync(selectedDatabase) || !statSync(selectedDatabase).isFile()) throw new Error("The selected Study Buddy runtime database does not exist; refusing to create a new environment.");
  const database = realpathSync(selectedDatabase);
  assertStudyBuddyPath(realpathSync(path.dirname(selectedDatabase)));
  assertStudyBuddyPath(database);
  // Auth initialization also touches state metadata and signing secrets. Inspect
  // path targets without reading any existing credential contents.
  const stateDir = path.dirname(selectedDatabase);
  for (const name of readdirSync(stateDir)) assertStudyBuddyPath(realpathSync(path.join(stateDir, name)));
  const secretsDir = path.join(stateDir, 'secrets');
  if (existsSync(secretsDir)) {
    assertStudyBuddyPath(realpathSync(secretsDir));
    for (const name of readdirSync(secretsDir)) assertStudyBuddyPath(realpathSync(path.join(secretsDir, name)));
  }
  const entrypoint = path.join(root, 't3code-fork', 'apps', 'server', 'dist', 'bin.mjs');
  if (!existsSync(entrypoint)) throw new Error("The matching Study Buddy server CLI is unavailable; build the selected app runtime first.");
  const response = await fetchImpl(new URL('/', ui), { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("The selected Study Buddy UI is not reachable.");
  const page = await response.text();
  if (!/<title[^>]*>[^<]*study buddy[^<]*<\/title>/iu.test(page)) throw new Error("The selected browser URL does not identify Study Buddy.");
  const args = [entrypoint, 'auth', 'pairing', 'create', '--base-dir', baseDir,
    ...(devUrl ? ['--dev-url', devUrl.origin] : []), '--ttl', '5m', '--label', 'T3 Study Buddy browser', '--base-url', ui.origin, '--json'];
  if (options.check) return { ok: true, checked: true, uiOrigin: ui.origin, baseDir, database, networkAccessChanged: false };
  const output = path.resolve(options.out || path.join(root, 'study-buddy-data', 'browser-pairing', `issued-${randomUUID()}.json`));
  assertStudyBuddyPath(canonicalPath(output));
  // Reserve before issuance so an existing file cannot be overwritten after a grant is minted.
  mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  const fd = openSync(output, 'wx', 0o600);
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(T3CODE_|VITE_|STUDY_BUDDY_)/u.test(key)));
    const result = run(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    // CLI diagnostics may contain auth data. Only emit a fixed failure outside the private file.
    if (result.error || result.status !== 0) throw new Error("Study Buddy's local pairing command failed; no existing credential was reused.");
    let grant;
    try { grant = JSON.parse(result.stdout); } catch { throw new Error("Study Buddy's pairing command returned an invalid result."); }
    const pairUrl = typeof grant.pairUrl === 'string' ? new URL(grant.pairUrl) : null;
    if (typeof grant.id !== 'string' || typeof grant.credential !== 'string' || !grant.credential || !pairUrl || pairUrl.origin !== ui.origin || pairUrl.pathname !== '/pair' || new URLSearchParams(pairUrl.hash.slice(1)).get('token') !== grant.credential || !Number.isFinite(Date.parse(grant.expiresAt))) {
      throw new Error("Study Buddy's pairing command returned an invalid grant.");
    }
    writeFileSync(fd, JSON.stringify(grant) + '\n');
    return { ok: true, credentialFile: output, id: grant.id, expiresAt: grant.expiresAt, uiOrigin: ui.origin, networkAccessChanged: false };
  } catch (error) {
    unlinkSync(output);
    throw error;
  } finally {
    closeSync(fd);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parsePairingArgs(process.argv.slice(2));
    console.log(options.help ? usage : JSON.stringify(await createBrowserPairing(options)));
  }
  catch { console.error(JSON.stringify({ ok: false, error: "Study Buddy browser pairing failed. Check --base-dir, --dev-url, the matching built runtime, and loopback --ui-url; existing files and credentials are not overwritten." })); process.exitCode = 1; }
}
