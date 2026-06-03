import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";

interface CrawlPage {
  url: string;
  depth: number;
}

export function createScraperNode(config: MoodleRuntimeConfig) {
  return async function scraperNode(_state: LangGraphAgentState): Promise<Partial<LangGraphAgentState>> {
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ headless: config.headless });
      const context = await browser.newContext(
        config.storageState ? { storageState: config.storageState } : undefined,
      );
      const page = await context.newPage();
      await ensureLoggedIn(page, config);

      const visited = new Set<string>();
      const queue: CrawlPage[] = [{ url: config.moodleUrl, depth: 0 }];
      const chunks: string[] = [];
      const sourcesDir = path.join(config.runDir, "sources");
      await mkdir(sourcesDir, { recursive: true });

      while (queue.length > 0 && visited.size < config.maxPages) {
        const next = queue.shift();
        if (!next || visited.has(next.url)) {
          continue;
        }
        visited.add(next.url);
        await page.goto(next.url, { waitUntil: "networkidle", timeout: 45_000 });
        await dismissCommonOverlays(page);

        const title = await page.title().catch(() => next.url);
        const text = await page.locator("body").innerText({ timeout: 15_000 }).catch(() => "");
        chunks.push(formatSourceChunk({ title, url: next.url, text }));

        if (config.allowFileDownloads) {
          await captureFileLinks(page, sourcesDir, chunks);
        }

        if (next.depth < config.maxDepth) {
          const links = await extractMoodleLinks(page, config.baseUrl);
          for (const link of links) {
            if (!visited.has(link) && queue.length + visited.size < config.maxPages) {
              queue.push({ url: link, depth: next.depth + 1 });
            }
          }
        }
      }

      return {
        moodle_raw_text: chunks.join("\n\n"),
        error_log: null,
      };
    } catch (error) {
      return {
        error_log: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await browser?.close();
    }
  };
}

async function ensureLoggedIn(page: Page, config: MoodleRuntimeConfig): Promise<void> {
  await page.goto(config.moodleUrl || config.dashboardUrl, { waitUntil: "networkidle", timeout: 45_000 });
  if (!(await looksLikeLoginPage(page))) {
    return;
  }
  if (!config.username || !config.password) {
    throw new Error("Moodle login is required, but MOODLE_USERNAME or MOODLE_PASSWORD is missing.");
  }

  await page.locator("#username, input[name='username'], input[type='text']").first().fill(config.username);
  await page.locator("#password, input[name='password'], input[type='password']").first().fill(config.password);
  const submit = page.locator("#loginbtn, button[type='submit'], input[type='submit']").first();
  if (await submit.count()) {
    await submit.click();
  } else {
    await page.keyboard.press("Enter");
  }
  await page.waitForLoadState("networkidle", { timeout: 45_000 });
  if (await looksLikeLoginPage(page)) {
    throw new Error("Moodle login did not complete; still on the login page.");
  }
}

async function looksLikeLoginPage(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (url.includes("/login/") || url.includes("errorcode=4")) {
    return true;
  }
  const haystack = `${await page.title().catch(() => "")}\n${await page.locator("body").innerText().catch(() => "")}`.toLowerCase();
  return (
    (haystack.includes("username") || haystack.includes("kennwort") || haystack.includes("password")) &&
    (haystack.includes("moodle login") || haystack.includes("log in") || haystack.includes("sitzung ist abgelaufen"))
  );
}

async function dismissCommonOverlays(page: Page): Promise<void> {
  for (const selector of ["text=Continue", "text=Weiter", "button:has-text('Continue')", "button:has-text('Weiter')"]) {
    const target = page.locator(selector).first();
    if (await target.count().catch(() => 0)) {
      await target.click().catch(() => undefined);
    }
  }
}

async function extractMoodleLinks(page: Page, baseUrl: string): Promise<string[]> {
  const origin = new URL(baseUrl).origin;
  const hrefs = await page.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((anchor) => (anchor as HTMLAnchorElement).href),
  );
  return [...new Set(hrefs)]
    .filter((href) => href.startsWith(origin))
    .filter((href) => href.includes("/course/") || href.includes("/mod/") || href.includes("/pluginfile.php"));
}

async function captureFileLinks(page: Page, sourcesDir: string, chunks: string[]): Promise<void> {
  const hrefs = await page.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((anchor) => ({
      href: (anchor as HTMLAnchorElement).href,
      label: ((anchor as HTMLAnchorElement).innerText || (anchor as HTMLAnchorElement).textContent || "").trim(),
    })),
  );
  const fileLinks = hrefs.filter(({ href }) => /\.(pdf|txt|md)$/i.test(new URL(href).pathname));
  for (const [index, link] of fileLinks.entries()) {
    const filename = safeFileName(`${index + 1}-${link.label || path.basename(new URL(link.href).pathname)}`);
    const target = path.join(sourcesDir, filename);
    const response = await page.context().request.get(link.href).catch(() => null);
    if (!response?.ok()) {
      chunks.push(`[Linked file]\nTitle: ${link.label || filename}\nURL: ${link.href}\nDownload failed`);
      continue;
    }

    const body = await response.body();
    await writeFile(target, body);
    const pathname = new URL(link.href).pathname.toLowerCase();
    const text =
      pathname.endsWith(".txt") || pathname.endsWith(".md")
        ? `\n\n${body.toString("utf8").trim()}`
        : "\n\nBinary file saved for future extraction.";
    chunks.push(`[Linked file]\nTitle: ${link.label || filename}\nURL: ${link.href}\nSaved path: ${target}${text}`);
  }
}

function formatSourceChunk(input: { title: string; url: string; text: string }): string {
  return [`[Moodle page]`, `Title: ${input.title}`, `URL: ${input.url}`, "", input.text.trim()].join("\n");
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "source";
}
