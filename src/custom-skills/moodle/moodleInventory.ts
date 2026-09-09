import type { Page } from "playwright";
import type { SearchCandidate } from "./semanticSearch.js";
import { enumeratePlaywrightOverview } from "./overviewEnumeration.js";

export interface EnrolledCourse extends SearchCandidate {
  courseId: number; start: number | null; end: number | null;
}
export interface CourseInventory { courses: EnrolledCourse[]; complete: boolean; method: string; error?: string }
export interface ActivityCard extends SearchCandidate {
  courseId: number; kind: string; context: string; dates: string[]; purpose?: string;
  accessible?: boolean; availabilityText?: string; accessRequirements?: string[];
}

const READ_METHODS = new Set([
  "core_course_get_enrolled_courses_by_timeline_classification",
  "core_calendar_get_action_events_by_timesort",
  "core_courseformat_get_state",
]);

/** Use Moodle's own authenticated read API. Session material stays inside the browser. */
export async function moodleRead<T>(page: Page, method: string, args: Record<string, unknown>): Promise<T> {
  if (!READ_METHODS.has(method)) throw new Error("Unsupported Moodle read operation");
  return page.evaluate(async ({ method, args }) => {
    const runtime = window as unknown as {
      require?: (deps: string[], ok: (ajax: { call: (requests: unknown[]) => Promise<unknown>[] }) => void, fail: (e: unknown) => void) => void;
    };
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Moodle read operation timed out")), 20000);
      if (!runtime.require) { clearTimeout(timer); reject(new Error("Moodle read API unavailable")); return; }
      runtime.require(["core/ajax"], ajax => {
        Promise.resolve(ajax.call([{ methodname: method, args }])[0]).then(
          value => { clearTimeout(timer); resolve(value); },
          () => { clearTimeout(timer); reject(new Error("Moodle read API rejected request")); },
        );
      }, () => { clearTimeout(timer); reject(new Error("Moodle read API unavailable")); });
    });
  }, { method, args }) as Promise<T>;
}

export async function readEnrolledCourses(page: Page, dashboardUrl: string): Promise<CourseInventory> {
  const origin = new URL(dashboardUrl).origin;
  await page.goto(dashboardUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator("main,#region-main").first().waitFor({ state: "attached", timeout: 10000 });
  const courses = new Map<number, EnrolledCourse>();
  try {
    let offset = 0;
    // Each request is paginated; never treat the first visible card page as all enrollment.
    for (let pageIndex = 0; pageIndex < 1000; pageIndex++) {
      const response = await moodleRead<{ courses: Record<string, unknown>[]; nextoffset: number }>(page,
        "core_course_get_enrolled_courses_by_timeline_classification",
        { classification: "allincludinghidden", limit: 100, offset, sort: "fullname asc" });
      if (!Array.isArray(response.courses)) throw new Error("Invalid course inventory");
      if (!response.courses.length) return { courses: [...courses.values()], complete: true, method: "enrolled_api" };
      const previousCount = courses.size;
      for (const raw of response.courses) {
        const id = Number(raw.id);
        if (!Number.isSafeInteger(id) || id <= 1) continue;
        const url = new URL(String(raw.viewurl || `course/view.php?id=${id}`), dashboardUrl).toString();
        if (new URL(url).origin !== origin || !/\/course\/view\.php$/.test(new URL(url).pathname)) continue;
        const label = plainText(String(raw.fullname ?? raw.shortname ?? `Course ${id}`));
        const start = positiveNumber(raw.startdate), end = positiveNumber(raw.enddate);
        courses.set(id, { id: `course-${id}`, courseId: id, url, label, start, end,
          text: [plainText(String(raw.shortname ?? "")), plainText(String(raw.summary ?? "")),
            start ? `Course start: ${new Date(start * 1000).toISOString()}` : "",
            end ? `Course end: ${new Date(end * 1000).toISOString()}` : "",
            raw.coursecategory ? `Category: ${plainText(String(raw.coursecategory))}` : "",
          ].filter(Boolean).join("\n"),
        });
      }
      if (response.nextoffset <= offset || courses.size === previousCount) throw new Error("Course enumeration stopped making progress");
      offset = response.nextoffset;
    }
    throw new Error("Course enumeration backstop reached");
  } catch (error) {
    // Source-specific DOM fallback stays on the user's overview, excluding global navigation.
    const overviewUrl = new URL("courses.php", dashboardUrl.endsWith("/") ? dashboardUrl : `${dashboardUrl}/`).toString();
    await page.goto(overviewUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    const overview = await enumeratePlaywrightOverview(page);
    const cards = await page.locator("main a[href*='/course/view.php'],#region-main a[href*='/course/view.php']").evaluateAll(anchors => anchors.map(a => ({
      url: (a as HTMLAnchorElement).href, label: (a.textContent ?? "").trim(),
    })));
    for (const card of cards) {
      const url = new URL(card.url); const id = Number(url.searchParams.get("id"));
      if (url.origin === origin && id > 1 && card.label) courses.set(id, { ...card, id: `course-${id}`, courseId: id, start: null, end: null });
    }
    return { courses: [...courses.values()], complete: false, method: "overview_dom",
      error: `Enrollment API unavailable; DOM enumeration observed ${overview.courseCount} links. Enrollment completeness requires verification.` };
  }
}

export async function readCourseActivities(page: Page, course: EnrolledCourse): Promise<{ activities: ActivityCard[]; text: string; complete: boolean; method: string; references: ActivityCard[] }> {
  await page.goto(course.url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator("main,#region-main").first().waitFor({ state: "attached" });
  const result = await page.evaluate(() => {
    const root = document.querySelector("main,#region-main") ?? document.body;
    const sectionHeadings = Array.from(root.querySelectorAll(".sectionname,.section-title,h2,h3,h4,[role='heading']"))
      .filter(h => !h.closest("li.activity,.activity-item,.activity,[data-for='cmitem'],[data-cmid]"));
    const activities = new Map<string, { url: string; label: string; text: string; context: string; dates: string[]; kind: string; purpose?: string }>();
    for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href*='/mod/'][href*='view.php']"))) {
      const url = new URL(a.href);
      if (!/\/mod\/[^/]+\/view\.php$/.test(url.pathname) || !url.searchParams.has("id")) continue;
      const row = a.closest("li.activity,.activity-item,.activity,[data-for='cmitem'],[data-cmid]") ?? a;
      const nativeName = a.closest(".activityname,.activityinstance,.activity-instance");
      const moduleId = a.closest("[id^='module-']")?.id.slice(7);
      const inlineReference = row !== a && !nativeName && !!moduleId && moduleId !== url.searchParams.get("id");
      // A prose link belongs to its own sentence, not every assignment mentioned
      // in the enclosing learning path. Preserve a small local context for review.
      const local = inlineReference ? (a.closest("p,li") ?? a.parentElement ?? a) : row;
      const section = a.closest("[data-for='section'],[id^='section-'],.course-section,li.section,.section,[data-sectionid]");
      const sectionHeading = section?.querySelector(".sectionname,.section-title,h2,h3,[role='heading']")?.textContent?.trim() ||
        sectionHeadings.filter(h => Boolean(h.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1)?.textContent?.trim() || "";
      const label = (a.textContent ?? "").replace(/\s+/g, " ").trim();
      const prior = activities.get(url.href);
      if (prior && prior.label.length >= label.length) continue;
      activities.set(url.href, { url: url.href, label, text: (local?.textContent ?? label).replace(/\s+/g, " ").trim(),
        purpose: Array.from(row.querySelector(".activityiconcontainer")?.classList ?? []).find(c => ["assessment", "communication", "content", "collaboration", "administration", "interactivecontent"].includes(c)),
        context: (sectionHeading + " " +
          (section?.querySelector(".summary,.section-summary")?.textContent ?? "")).replace(/\s+/g, " ").trim(),
        dates: Array.from(row?.querySelectorAll("time[datetime]") ?? []).map(t => t.getAttribute("datetime") ?? ""),
        kind: url.pathname.split("/mod/")[1].split("/")[0],
      });
    }
    const texts = Array.from(root.querySelectorAll(".sectionname,h1,h2,h3,.summary,.section-summary")).map(e => (e.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
    const moduleDetails = Array.from(root.querySelectorAll<HTMLElement>("[id^='module-']")).map(row => ({
      id: Number(row.id.slice(7)), text: (row.textContent ?? "").replace(/\s+/g, " ").trim(),
      availabilityText: Array.from(row.querySelectorAll(".availabilityinfo")).map(e => (e.textContent ?? "").replace(/\s+/g, " ").trim()).join("\n"),
      accessRequirements: Array.from(row.querySelectorAll(".availabilityinfo li")).filter(e => !e.querySelector("li")).map(e => (e.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean),
    }));
    const lazy = root.querySelector("[data-action='loadmore'],[data-action='load-more'],[data-region='loading'][aria-busy='true']");
    return { activities: [...activities.values()], text: [...new Set(texts)].join("\n"), complete: !lazy, moduleDetails };
  });
  const origin = new URL(course.url).origin;
  const observed = result.activities.filter(a => new URL(a.url).origin === origin).map(a => ({
    ...a, text: redactSourceText(a.text), context: redactSourceText(a.context), id: `${a.kind}-${new URL(a.url).searchParams.get("id")}`, courseId: course.courseId,
  }));
  try {
    const raw = await moodleRead<string | { cm: Record<string, unknown>[]; section: Record<string, unknown>[] }>(page, "core_courseformat_get_state", { courseid: course.courseId });
    const state = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(state.cm) || !Array.isArray(state.section)) throw new Error("Invalid course module state");
    const sections = new Map(state.section.map((s: Record<string, unknown>) => [Number(s.id), plainText(String(s.title ?? s.name ?? ""))]));
    const activities: ActivityCard[] = [];
    for (const cm of state.cm as Record<string, unknown>[]) {
      const id = Number(cm.id), kind = String(cm.module ?? "");
      if (!Number.isSafeInteger(id) || id <= 0 || !/^[a-z][a-z0-9_]*$/.test(kind) || !cm.url) continue;
      const url = new URL(String(cm.url), course.url);
      if (url.origin !== origin || !/\/mod\/[^/]+\/view\.php$/.test(url.pathname) || Number(url.searchParams.get("id")) !== id) continue;
      const match = observed.find(a => a.url === url.href);
      const label = plainText(String(cm.name ?? match?.label ?? kind));
      const details = result.moduleDetails.find(d => d.id === id);
      activities.push({ ...match, id: `${kind}-${id}`, courseId: course.courseId, kind, url: url.href, label,
        text: redactSourceText(details?.text || match?.text || label), context: String(sections.get(Number(cm.sectionid)) || match?.context || ""), dates: match?.dates ?? [],
        accessible: typeof cm.uservisible === "boolean" ? cm.uservisible : undefined,
        availabilityText: redactSourceText(details?.availabilityText ?? ""), accessRequirements: details?.accessRequirements ?? [] });
    }
    const urls = new Set(activities.map(a => a.url));
    return { activities, text: [redactSourceText(result.text), ...sections.values()].filter(Boolean).join("\n"), complete: true,
      method: "course_state_api", references: observed.filter(a => !urls.has(a.url)) };
  } catch {
    // A visible page can be only one section. Preserve it as a partial fallback,
    // never claim complete enrollment/activity coverage from its DOM alone.
    return { text: redactSourceText(result.text), activities: observed, complete: false, method: "course_dom_partial", references: [] };
  }
}

/** One index page exposes dates/status for many activities without opening any attempt. */
export async function readActivityIndex(page: Page, course: EnrolledCourse, kind: string): Promise<Map<string, string>> {
  if (!/^[a-z][a-z0-9_]*$/.test(kind)) throw new Error("Invalid module kind");
  const courseUrl = new URL(course.url);
  const prefix = courseUrl.pathname.slice(0, courseUrl.pathname.lastIndexOf("/course/"));
  const url = new URL(`${prefix}/mod/${kind}/index.php?id=${course.courseId}`, course.url);
  const response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30000 });
  if (response && !response.ok()) throw new Error("Activity index unavailable");
  const rows = await page.evaluate(() => {
    const result: Array<[string, string]> = [];
    for (const table of Array.from(document.querySelectorAll("main table,#region-main table"))) {
      const headings = Array.from(table.querySelectorAll("thead th")).map(h => h.textContent?.trim() ?? "");
      for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
        const cells = Array.from(row.querySelectorAll("td")).map((cell, i) => `${headings[i] ?? `Column ${i + 1}`}: ${(cell.textContent ?? "").replace(/\s+/g, " ").trim()}`);
        for (const a of Array.from(row.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
          if (/\/mod\/[^/]+\/view\.php$/.test(new URL(a.href).pathname)) result.push([a.href, cells.join("\n")]);
        }
      }
    }
    return result;
  });
  return new Map(rows.map(([url, text]) => [url, redactSourceText(text)]));
}

export async function readActivityLanding(page: Page, activity: ActivityCard): Promise<string> {
  const url = new URL(activity.url);
  if (!/\/mod\/[a-z][a-z0-9_]*\/view\.php$/.test(url.pathname) || !/^\d+$/.test(url.searchParams.get("id") ?? "")) throw new Error("Not a read-only activity landing URL");
  const popupPromise = activity.kind === "lti" ? page.waitForEvent("popup", { timeout: 5000 }).catch(() => null) : null;
  const response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30000 });
  if (response && !response.ok()) throw new Error("Activity landing unavailable");
  const resolved = new URL(page.url());
  if (resolved.origin !== url.origin || resolved.pathname !== url.pathname) throw new Error("Activity redirected outside its landing page");
  const embeddedActivity = ["hvp", "h5pactivity", "scorm"].includes(activity.kind);
  if (embeddedActivity) await page.waitForTimeout(1500);
  const text = await page.locator("main,#region-main").first().evaluate(root => {
    const actions = Array.from(root.querySelectorAll("form button,input[type='submit']")).map(e => e instanceof HTMLInputElement ? e.value : e.textContent ?? "").map(t => t.replace(/\s+/g, " ").trim()).filter(Boolean);
    const clone = root.cloneNode(true) as HTMLElement;
    // Questions are not part of an obligation/status read, even if a plugin embeds them here.
    clone.querySelectorAll(".que,.h5p-question,.h5p-single-choice-set,form,input,textarea,select,script,style,noscript,object,embed").forEach(e => e.remove());
    return [(clone.textContent ?? "").replace(/\s+/g, " ").trim(), actions.length ? `Available action labels (not invoked): ${[...new Set(actions)].join("; ")}` : ""].filter(Boolean).join("\n");
  });
  if (!popupPromise) {
    const parts = await readExternalFrames(page, false);
    if (embeddedActivity && !parts.length && /^(?:Abschlussbedingungen|Completion requirements)?\s*$/i.test(text)) throw new Error("Embedded activity metadata unavailable; empty module shell is not deadline evidence");
    return redactSourceText([text, ...parts].filter(Boolean).join("\n"));
  }
  const popup = await popupPromise;
  if (!popup) {
    if (/neuen Fenster|new window/i.test(text)) throw new Error("External activity content was not opened; launch page is not deadline evidence");
    const parts = await readExternalFrames(page, false);
    if (!parts.length) throw new Error("External activity metadata unavailable; empty launch page is not deadline evidence");
    return redactSourceText(`${text}\n${parts.join("\n")}`);
  }
  try {
    await popup.waitForLoadState("domcontentloaded", { timeout: 20000 });
    await popup.locator("body").waitFor({ state: "attached", timeout: 10000 });
    // Allow the source's own SSO/embedded frame to settle without clicking an
    // attempt, login, consent or submission control.
    await popup.waitForTimeout(1500);
    if (await popup.locator("input[type='password']:visible").count()) throw new Error("External activity requires authentication");
    const parts = await readExternalFrames(popup, true);
    if (!parts.length) throw new Error("External activity metadata unavailable");
    return redactSourceText(`${text}\n${parts.join("\n")}`);
  } finally { await popup.close().catch(() => undefined); }
}

async function readExternalFrames(page: Page, includeMain: boolean): Promise<string[]> {
    const parts: string[] = [];
    for (const frame of page.frames()) {
      if (frame === page.mainFrame() && !includeMain) continue;
      if (frame !== page.mainFrame()) {
        const element = await frame.frameElement().catch(() => null);
        if (!element || !await element.isVisible()) continue;
      }
      if (frame.url().startsWith("chrome-error:")) throw new Error("External activity browser error page; source unavailable");
      await frame.locator("body").waitFor({ state: "attached", timeout: 10000 }).catch(() => undefined);
      if (await frame.locator("input[type='password']:visible").count().catch(() => 0)) throw new Error("External activity requires authentication");
      const part = await frame.locator("body").evaluate(root => {
        // A zero-height body can host visible positioned frames. Read rendered
        // text, not hidden provider templates or question/form internals.
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const parts: string[] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const parent = node.parentElement;
          if (!parent || parent.closest(".que,.question,.problem,.h5p-question,.h5p-single-choice-set,input,textarea,select,script,style,noscript,object,embed,[hidden],[aria-hidden='true']")) continue;
          const style = getComputedStyle(parent);
          if (style.visibility === "hidden" || style.visibility === "collapse") continue;
          const range = document.createRange(); range.selectNodeContents(node);
          if (!Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0)) continue;
          parts.push(node.textContent ?? "");
        }
        const questionInterfaces = Array.from(root.querySelectorAll(".h5p-question,.h5p-single-choice-set")).filter(element => {
          const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility === "visible" && !element.closest("[hidden],[aria-hidden='true']");
        });
        if (questionInterfaces.length) {
          parts.push("Reader observation: visible H5P question interface; question text omitted.");
          const actions = Array.from(root.querySelectorAll(".h5p-question button,.h5p-single-choice-set button")).filter(element => {
            const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility === "visible" && !element.closest("[hidden],[aria-hidden='true'],.h5p-alternative,.h5p-answer,.h5p-true-false-answer");
          }).map(element => (element.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
          if (actions.length) parts.push(`Available action labels (not invoked): ${[...new Set(actions)].join("; ")}`);
        }
        return parts.join(" ").replace(/\s+/g, " ").trim();
      }).catch(() => "");
      if (part.length >= 30) {
        const target = new URL(frame.url());
        const source = ["http:", "https:"].includes(target.protocol) ? `External source: ${target.origin}${target.pathname}` : "Embedded content from the activity page";
        parts.push(`${source}\n${part}`);
      }
    }
    return [...new Set(parts)];
}

export function redactSourceText(value: string): string {
  return value.replace(/([?&](?:amp;)?(?:sesskey|token|access_token|auth_token|password|secret)=)[^&\s<>"']+/gi, "$1[redacted]");
}
export function plainText(value: string): string {
  return redactSourceText(value).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
function positiveNumber(value: unknown): number | null {
  const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null;
}
