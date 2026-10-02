#!/usr/bin/env node
import { DirectSources, directSourcesRoot } from "./directSources.js";
import { PlaywrightDirectSourceBackend, type DirectSourcePortal } from "./directSourcesBackend.js";
const env = process.env;
try {
  if (env.STUDY_BUDDY_BROKER_EXECUTION !== "1") throw Error("Direct source operations require the Study Buddy broker.");
  if (!env.STUDY_BUDDY_WORKSPACE?.trim() || !env.STUDY_BUDDY_DOCUMENT_OWNER_THREAD_ID?.trim()) throw Error("Direct sources require the broker-owned workspace and stable document thread.");
  if (process.argv.length !== 3) throw Error("Pass exactly one JSON source request.");
  const moodle = env.MOODLE_DASHBOARD_URL || env.STUDY_BUDDY_MOODLE_URL || env.MOODLE_BASE_URL;
  const origins = (value: string | undefined) => (value ?? "").split(/[\s,]+/).filter(Boolean).map(value => new URL(value).origin);
  const portals: DirectSourcePortal[] = moodle ? [{ dashboard: moodle, username: env.MOODLE_USERNAME, password: env.MOODLE_PASSWORD, loginOrigins: origins(env.MOODLE_LOGIN_ALLOWED_ORIGINS), storageState: env.MOODLE_STORAGE_STATE }] : [];
  const cis = env.CIS_DASHBOARD_URL || env.STUDY_BUDDY_CIS_URL || env.CIS_BASE_URL;
  if (cis) portals.push({ dashboard: cis, username: env.CIS_USERNAME || env.MOODLE_USERNAME, password: env.CIS_PASSWORD || env.MOODLE_PASSWORD, loginOrigins: origins(env.CIS_LOGIN_ALLOWED_ORIGINS) });
  if (!portals.length) throw Error("No university source URL is configured.");
  const root = directSourcesRoot({ ...env, STUDY_BUDDY_THREAD_ID: env.STUDY_BUDDY_DOCUMENT_OWNER_THREAD_ID || env.STUDY_BUDDY_THREAD_ID });
  const result = await new DirectSources(root, portals.map(portal => new URL(portal.dashboard).origin), new PlaywrightDirectSourceBackend(portals)).run(JSON.parse(process.argv[2]!));
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  const message = error instanceof Error ? error.message : "Source operation failed.";
  // Never serialize raw browser/HTTP errors containing secrets.
  const secrets = [env.MOODLE_PASSWORD, env.CIS_PASSWORD, env.MOODLE_USERNAME, env.CIS_USERNAME].filter((value): value is string => Boolean(value));
  process.stdout.write(JSON.stringify({ ok: false, error: secrets.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), message) }) + "\n");
  process.exitCode = 1;
}
