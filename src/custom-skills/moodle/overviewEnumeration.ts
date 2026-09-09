import type { AgentBrowserSnapshot } from "./agentBrowserClient.js";
import type { Page } from "playwright";

export interface OverviewClient {
  snapshot(): Promise<AgentBrowserSnapshot>;
  click(selector: string): Promise<unknown>;
  wait(ms: number): Promise<unknown>;
}

export async function enumeratePlaywrightOverview(page: Page): Promise<OverviewEnumeration> {
  const selector = "a[href],button,[role=button]";
  const snapshot = async (): Promise<AgentBrowserSnapshot> => page.evaluate((selector) => {
    const lines: string[] = [];
    const mainText = (document.querySelector("main,#region-main") as HTMLElement | null)?.innerText ?? "";
    const count = /\b\d+\s+(?:Kurse|courses)\s*(?:-|–|gefunden|found)/i.exec(mainText)?.[0];
    if (count) lines.push(count);
    document.querySelectorAll<HTMLElement>(selector).forEach((element, index) => {
      const href = element instanceof HTMLAnchorElement ? element.href : "";
      const label = (element.getAttribute("aria-label") || element.innerText || "").trim().replace(/\s+/g, " ");
      const course = /\/course\/view\.php\?id=\d+/.test(href);
      const visible = element.getClientRects().length > 0;
      if (!course && !visible) return;
      const disabled = element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true" || Boolean(element.closest(".disabled"));
      lines.push(`${href ? "link" : "button"} ${JSON.stringify(label)} [ref=ov${index}${href ? `, url=${href}` : ""}${disabled ? ", disabled=true" : ""}]`);
    });
    return { origin: location.href, refs: {}, snapshot: lines.join("\n") };
  }, selector);
  return enumerateCourseOverview({
    snapshot,
    click: ref => page.locator(selector).nth(Number(ref.replace("@ov", ""))).click({ timeout: 2000 }),
    wait: ms => page.waitForTimeout(ms),
  }, await snapshot());
}

export interface OverviewEnumeration {
  snapshot: AgentBrowserSnapshot;
  complete: boolean;
  pages: number;
  courseCount: number;
  advertisedCount: number | null;
}

/** Follow read-only overview pagination; never infer completion from a page limit. */
export async function enumerateCourseOverview(client: OverviewClient, first: AgentBrowserSnapshot, maxPages = 50): Promise<OverviewEnumeration> {
  const snapshots: AgentBrowserSnapshot[] = [];
  const courses = new Set<string>();
  const signatures = new Set<string>();
  let current = first;
  let complete = false;
  let advertisedCount: number | null = null;
  for (let round = 0; round < maxPages; round++) {
    snapshots.push(current);
    for (const match of current.snapshot.matchAll(/url=(https?:\/\/[^\]\s]+\/course\/view\.php\?id=\d+)/g)) courses.add(match[1]);
    const count = /\b(\d+)\s+(?:Kurse|courses)\s*(?:-|–|gefunden|found)/i.exec(current.snapshot)?.[1];
    if (count) advertisedCount = Math.max(advertisedCount ?? 0, Number(count));
    const control = current.snapshot.split("\n").find(line => {
      if (/disabled(?:=true)?|aria-disabled=true/i.test(line)) return false;
      if (!/\b(?:button|link)\b/.test(line)) return false;
      const label = /"([^"]+)"/.exec(line)?.[1] ?? "";
      return /^(?:next(?: page)?|nächste(?: seite)?|weiter|mehr(?: kurse)?(?: anzeigen| laden)?|weitere kurse(?: anzeigen| laden)?|load more(?: courses)?|show more(?: courses)?)$/i.test(label);
    });
    if (!control) { complete = advertisedCount === null || courses.size >= advertisedCount; break; }
    const signature = [...current.snapshot.matchAll(/url=(https?:\/\/[^\]\s]+\/course\/view\.php\?id=\d+)/g)].map(match => match[1]).sort().join("|");
    if (signatures.has(signature)) break;
    signatures.add(signature);
    const ref = /ref=([a-z0-9_-]+)/i.exec(control)?.[1];
    if (!ref) break;
    try {
      await client.click(`@${ref}`);
      await client.wait(400);
      current = await client.snapshot();
    } catch { break; }
  }
  // Re-key refs: page transitions reuse reference IDs, which must not rewrite earlier labels.
  const refs: AgentBrowserSnapshot["refs"] = {};
  const text = snapshots.map((snapshot, page) => snapshot.snapshot.replace(/ref=([a-z0-9_-]+)/gi, (_, ref: string) => {
    const key = `overview-${page}-${ref}`;
    if (snapshot.refs[ref]) refs[key] = snapshot.refs[ref];
    return `ref=${key}`;
  })).join("\n");
  return { snapshot: { origin: first.origin, refs, snapshot: text }, complete, pages: snapshots.length, courseCount: courses.size, advertisedCount };
}
