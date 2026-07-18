import type { Page } from "playwright";
import type { AgentBrowserClient } from "./agentBrowserClient.js";

export interface BrowserLoginConfig {
  serviceName: string;
  targetUrl: string;
  username?: string;
  password?: string;
  allowedOrigins: ReadonlySet<string>;
}

export function createBrowserLoginConfig(input: {
  serviceName: string;
  targetUrl: string;
  username?: string;
  password?: string;
  allowedOrigins?: readonly string[];
}): BrowserLoginConfig {
  const target = new URL(input.targetUrl);
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(target.hostname);
  if (target.protocol !== "https:" && !(target.protocol === "http:" && loopback)) {
    throw new Error(`${input.serviceName} login requires HTTPS.`);
  }
  return {
    ...input,
    allowedOrigins: new Set([target.origin, ...(input.allowedOrigins ?? [])]),
  };
}

export async function ensureLoggedIn(page: Page, config: BrowserLoginConfig): Promise<void> {
  const response = await page.goto(config.targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  if (response && !response.ok()) {
    throw new Error(`${config.serviceName} returned HTTP ${response.status()} while opening the configured page.`);
  }
  assertExpectedOrigin(page.url(), config);
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);

  const password = await firstVisible(page, [
    "#password",
    "input[name='password']",
    "input[autocomplete='current-password']",
    "input[type='password']",
  ]);
  if (!password) return;
  if (!config.username || !config.password) {
    throw new Error(`${config.serviceName} login is required, but username or password is missing.`);
  }
  const username = await firstVisible(page, [
    "#username",
    "input[name='username']",
    "input[name='user']",
    "input[name='login']",
    "input[name='email']",
    "input[autocomplete='username']",
    "input[type='email']",
  ]);
  if (!username) throw new Error(`${config.serviceName} login username field was not found.`);

  await username.fill(config.username);
  await password.fill(config.password);
  const submit = await firstVisible(page, [
    "#loginbtn",
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('Sign in')",
    "button:has-text('Log in')",
    "button:has-text('Anmelden')",
  ]);
  if (!submit) throw new Error(`${config.serviceName} login submit control was not found.`);
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => undefined),
    submit.click(),
  ]);
  assertExpectedOrigin(page.url(), config);
  if (await hasLoginForm(page)) {
    throw new Error(`${config.serviceName} login did not complete.`);
  }

  // Replace the credential-bearing document before any model-visible extraction.
  await page.goto(page.url(), { waitUntil: "domcontentloaded", timeout: 45_000 });
  assertExpectedOrigin(page.url(), config);
}

export async function ensureAgentBrowserLoggedIn(
  client: AgentBrowserClient,
  config: BrowserLoginConfig,
): Promise<void> {
  if (client.secureLogin) {
    await client.secureLogin(config);
    return;
  }
  await client.open(config.targetUrl);
  const snapshot = await client.snapshot({ interactive: true, compact: true });
  const loginVisible = Object.values(snapshot.refs).some((ref) =>
    /(?:password|passcode|current-password)/i.test(`${ref.role ?? ""} ${ref.name ?? ""}`),
  );
  if (loginVisible) {
    throw new Error(
      `${config.serviceName} requires login. Credential entry through the agent-browser CLI is blocked; use the Playwright backend.`,
    );
  }
}

function assertExpectedOrigin(actualUrl: string, config: BrowserLoginConfig): void {
  if (!config.allowedOrigins.has(new URL(actualUrl).origin)) {
    throw new Error(`${config.serviceName} redirected to an unexpected origin.`);
  }
}

async function firstVisible(page: Page, selectors: readonly string[]) {
  for (const selector of selectors) {
    const candidate = page.locator(selector).first();
    if ((await candidate.count().catch(() => 0)) > 0 && (await candidate.isVisible().catch(() => false))) {
      return candidate;
    }
  }
  return null;
}

async function hasLoginForm(page: Page): Promise<boolean> {
  const username = await firstVisible(page, [
    "#username",
    "input[name='username']",
    "input[name='user']",
    "input[name='login']",
    "input[name='email']",
    "input[autocomplete='username']",
  ]);
  const password = await firstVisible(page, [
    "#password",
    "input[name='password']",
    "input[autocomplete='current-password']",
  ]);
  const submit = await firstVisible(page, [
    "#loginbtn",
    "button[type='submit']",
    "input[type='submit']",
  ]);
  return Boolean(username && password && submit);
}
