import type { Page } from "playwright";
import type { AgentBrowserClient, AgentBrowserSnapshot } from "./agentBrowserClient.js";

export interface BrowserLoginConfig {
  serviceName: string;
  targetUrl: string;
  username?: string;
  password?: string;
  allowedOrigins?: readonly string[];
}

export function createBrowserLoginConfig(config: BrowserLoginConfig): BrowserLoginConfig {
  const target = validatedLoginUrl(config.targetUrl, config.serviceName);
  const allowedOrigins = new Set([target.origin]);
  for (const value of config.allowedOrigins ?? []) {
    allowedOrigins.add(validatedLoginUrl(value, config.serviceName).origin);
  }
  return { ...config, targetUrl: target.toString(), allowedOrigins: [...allowedOrigins] };
}

export async function ensureLoggedIn(page: Page, config: BrowserLoginConfig): Promise<void> {
  config = createBrowserLoginConfig(config);
  await page.goto(config.targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  assertExpectedOrigin(page.url(), config);
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  assertExpectedOrigin(page.url(), config);
  await assertNoExplicitAuthFailure(page, config.serviceName);
  if (!(await looksLikeLoginPage(page))) {
    return;
  }
  if (!config.username || !config.password) {
    throw new Error(`${config.serviceName} login is required, but username or password is missing.`);
  }

  const filledUsername = await fillFirstVisible(
    page,
    ["#username", "input[name='username']", "input[type='email']", "input[type='text']"],
    config.username,
  );
  const filledPassword = await fillFirstVisible(
    page,
    ["#password", "input[name='password']", "input[type='password']"],
    config.password,
  );
  if (!filledUsername || !filledPassword) {
    throw new Error(`${config.serviceName} login form fields were not found or visible.`);
  }
  const submit = await firstVisibleLocator(page, [
    "#loginbtn",
    "button[type='submit']",
    "input[type='submit']",
  ]);
  if (submit) {
    await submit.click();
  } else {
    await page.keyboard.press("Enter");
  }
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => undefined);
  assertExpectedOrigin(page.url(), config);
  await assertNoExplicitAuthFailure(page, config.serviceName);
  if (await looksLikeLoginPage(page)) {
    throw new Error(`${config.serviceName} login did not complete; still on the login page.`);
  }
}

export async function dismissCommonOverlays(page: Page): Promise<void> {
  for (const selector of [
    "text=Continue",
    "text=Weiter",
    "button:has-text('Continue')",
    "button:has-text('Weiter')",
  ]) {
    const target = page.locator(selector).first();
    if (!(await target.count().catch(() => 0))) continue;
    if (!(await target.isVisible().catch(() => false))) continue;
    if (!(await target.isEnabled().catch(() => false))) continue;
    await target.click({ timeout: 750 }).catch(() => undefined);
  }
}

export async function looksLikeLoginPage(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  const visiblePassword = await firstVisibleLocator(page, [
    "#password",
    "input[name='password']",
    "input[type='password']",
  ]);
  if (!visiblePassword) {
    return false;
  }
  const visibleUsername = await firstVisibleLocator(page, [
    "#username",
    "input[name='username']",
    "input[type='email']",
  ]);
  const visibleSubmit = await firstVisibleLocator(page, [
    "#loginbtn",
    "button[type='submit']",
    "input[type='submit']",
  ]);
  if (visibleUsername && visibleSubmit) {
    return true;
  }
  const haystack = `${await page.title().catch(() => "")}\n${await page
    .locator("body")
    .innerText({ timeout: 5_000 })
    .catch(() => "")}`.toLowerCase();
  if (url.includes("/login/") || url.includes("errorcode=4") || url.includes("auth")) {
    return /(username|benutzer|kennwort|password)/i.test(haystack);
  }
  return (
    (haystack.includes("username") ||
      haystack.includes("benutzer") ||
      haystack.includes("kennwort") ||
      haystack.includes("password")) &&
    (haystack.includes("log in") ||
      haystack.includes("login") ||
      haystack.includes("anmelden") ||
      haystack.includes("sitzung ist abgelaufen") ||
      haystack.includes("session has timed out"))
  );
}

export async function assertNoExplicitAuthFailure(page: Page, serviceName: string): Promise<void> {
  const haystack = `${await page.title().catch(() => "")}\n${await page
    .locator("body")
    .innerText({ timeout: 5_000 })
    .catch(() => "")}`.toLowerCase();
  const explicitFailures = [
    "provided authentication credentials are invalid",
    "authentication credentials are invalid",
    "invalid credentials",
    "ungültige authentifizierungsdaten",
    "ungültige zugangsdaten",
    "login failed",
    "anmeldung fehlgeschlagen",
    "invalid login, please try again",
    "ungültiger login",
    "invalid username or password",
    "falscher benutzername oder falsches kennwort",
  ];
  const matched = explicitFailures.find((pattern) => haystack.includes(pattern));
  if (matched) {
    throw new Error(`${serviceName} authentication failed: ${matched}`);
  }
}

export function isAuthFailure(message: string): boolean {
  return /login|auth|credential|kennwort|zugangsdaten|anmeldung/i.test(message);
}

export async function ensureAgentBrowserLoggedIn(
  client: AgentBrowserClient,
  config: BrowserLoginConfig,
): Promise<void> {
  config = createBrowserLoginConfig(config);
  await client.open(config.targetUrl);
  await client.wait(750).catch(() => undefined);
  assertExpectedOrigin(await client.getUrl(), config);
  await assertNoExplicitAgentBrowserAuthFailure(client, config.serviceName);
  if (!(await looksLikeAgentBrowserLoginPage(client))) {
    return;
  }
  if (!config.username || !config.password) {
    throw new Error(`${config.serviceName} login is required, but username or password is missing.`);
  }

  throw new Error(
    `${config.serviceName} requires login. Credential entry through the agent-browser CLI is blocked; use the Playwright backend.`,
  );
}

function validatedLoginUrl(value: string, serviceName: string): URL {
  const parsed = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error(`${serviceName} login requires HTTPS.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${serviceName} login URL must not contain credentials.`);
  }
  return parsed;
}

function assertExpectedOrigin(actualUrl: string, config: BrowserLoginConfig): void {
  const actualOrigin = validatedLoginUrl(actualUrl, config.serviceName).origin;
  if (!(config.allowedOrigins ?? []).includes(actualOrigin)) {
    throw new Error(`${config.serviceName} redirected to an unexpected origin.`);
  }
}

export async function looksLikeAgentBrowserLoginPage(client: AgentBrowserClient): Promise<boolean> {
  const snapshot = await getAgentBrowserSnapshot(client);
  if (!snapshot) {
    return false;
  }
  const url = snapshot.origin.toLowerCase();
  const haystack = snapshotToText(snapshot).toLowerCase();
  if (url.includes("/login/") || url.includes("errorcode=4") || url.includes("auth")) {
    return /(username|benutzer|kennwort|password)/i.test(haystack);
  }
  return (
    (haystack.includes("username") ||
      haystack.includes("benutzer") ||
      haystack.includes("kennwort") ||
      haystack.includes("password")) &&
    (haystack.includes("log in") ||
      haystack.includes("login") ||
      haystack.includes("anmelden") ||
      haystack.includes("moodle login") ||
      haystack.includes("sitzung ist abgelaufen") ||
      haystack.includes("session has timed out"))
  );
}

async function assertNoExplicitAgentBrowserAuthFailure(
  client: AgentBrowserClient,
  serviceName: string,
): Promise<void> {
  const snapshot = await getAgentBrowserSnapshot(client);
  const haystack = snapshot ? snapshotToText(snapshot).toLowerCase() : "";
  const explicitFailures = [
    "provided authentication credentials are invalid",
    "authentication credentials are invalid",
    "invalid credentials",
    "ungültige authentifizierungsdaten",
    "ungültige zugangsdaten",
    "login failed",
    "anmeldung fehlgeschlagen",
    "invalid login, please try again",
    "ungültiger login",
    "invalid username or password",
    "falscher benutzername oder falsches kennwort",
  ];
  const matched = explicitFailures.find((pattern) => haystack.includes(pattern));
  if (matched) {
    throw new Error(`${serviceName} authentication failed: ${matched}`);
  }
}

async function getAgentBrowserSnapshot(client: AgentBrowserClient): Promise<AgentBrowserSnapshot | null> {
  return client.snapshot({ interactive: true, urls: true, compact: true }).catch(() => null);
}

function snapshotToText(snapshot: AgentBrowserSnapshot): string {
  return snapshot.snapshot
    .split("\n")
    .map((line) => line.replace(/\s*\[ref=[^\]]+\]/g, "").replace(/\s*url=\S+/g, "").trim())
    .filter(Boolean)
    .join("\n");
}

async function fillFirstVisible(
  page: Page,
  selectors: string[],
  value: string,
): Promise<boolean> {
  const target = await firstVisibleLocator(page, selectors);
  if (!target) {
    return false;
  }
  await target.fill(value);
  return true;
}

async function firstVisibleLocator(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const matches = page.locator(selector);
    const count = await matches.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = matches.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }
  }
  return null;
}
