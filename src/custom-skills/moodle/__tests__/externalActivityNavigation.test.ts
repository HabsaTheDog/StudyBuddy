import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { chromium, type Browser } from "playwright";
import { compatibleActivityIdentifier, navigateExternalActivity, rejectOptionalCookies, safeNavigationHref } from "../externalActivityNavigation.js";
import { moodleTestConfig } from "./support/moodleTestBlocks.js";
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser.close(); });
const task = { id: "lti-42", courseId: 12, kind: "lti", label: "8.4 - Task ***", url: "https://source.example/mod/lti/view.php?id=42", context: "Chapter 8", dates: [] };
const config = moodleTestConfig();
it.each(["#task", "javascript:void(0)", "javascript:void(0);"])("rejects script-only navigation %s", href => {
  expect(safeNavigationHref(href, "https://source.example")).toBe(false);
});
const links = (prompt: string): Array<{ id: string; label: string; visible: boolean; visited: boolean }> => JSON.parse(prompt.split("Available links: ")[1]!);

it("opens a source section and verifies the exact task without invoking attempt controls", async () => {
  const p = await browser.newPage();
  await p.route('https://source.example/**', r => {
    const destination = new URL(r.request().url()).pathname;
    const body = destination === '/task'
      ? '<main>Due date: 9 September 2026. Status unknown.</main>'
      : destination === '/chapter'
        ? '<a href="/task" onclick="window.attempts++">8.4 - Friction task ***</a>'
        : '<a href="/chapter" onclick="window.attempts++">Chapter 8</a><a href="/attempt">Start attempt</a>';
    return r.fulfill({ contentType: 'text/html', body: body + '<script>window.attempts=0</script>' });
  });
  await p.goto('https://source.example/home');
  const model = { run: vi.fn(async (prompt: string) => {
    if (prompt.startsWith('Independently')) return JSON.stringify({ matches: true, quote: '8.4 - Friction task ***' });
    const choices = links(prompt);
    expect(choices.some(l => l.label === 'Start attempt')).toBe(false);
    const selected = choices.find(l => l.visible && !l.visited && (l.label === 'Chapter 8' || l.label === '8.4 - Friction task ***'))!;
    return JSON.stringify({ id: selected.id, kind: selected.label === 'Chapter 8' ? 'section' : 'activity', reason: 'Exact chapter and task identifier/difficulty' });
  }) };
  expect(await navigateExternalActivity(p, task, model, config)).toBe(true);
  expect(await p.locator('main').textContent()).toContain('Due date: 9 September 2026');
  expect(await p.evaluate('window.attempts')).toBe(0);
  expect(model.run).toHaveBeenCalledTimes(1);
  await p.close();
}, 15000);

it.each(['hidden', 'wrong-id', 'wrong-number', 'wrong-difficulty', 'failed-review'])("rejects unsafe or unverified navigation: %s", async mode => {
  const p = await browser.newPage();
  await p.route('https://source.example/**', r => r.fulfill({ contentType: 'text/html', body: `<a href='/target' ${mode === 'hidden' ? 'hidden' : ''} onclick='window.clicked=true'>${mode === 'wrong-number' ? '8.5 - Task ***' : mode === 'wrong-difficulty' ? '8.4 - Task **' : '8.4 - Task ***'}</a><a href='/chapter'>Chapter 8</a><script>window.clicked=false</script>` }));
  await p.goto('https://source.example/home');
  const model = { run: vi.fn(async (prompt: string) => prompt.startsWith('Independently') ? JSON.stringify({ matches: false, quote: '8.4 - Task ***' }) : JSON.stringify({ id: mode === 'wrong-id' ? 'forged-id' : links(prompt)[0]!.id, kind: 'activity', reason: 'Guess' })) };
  expect(await navigateExternalActivity(p, ['wrong-id', 'failed-review'].includes(mode) ? { ...task, label: 'Friction task ***' } : task, model, config)).toBe(false);
  expect(await p.evaluate('window.clicked')).toBe(false);
  await p.close();
});

it("stops at three section navigations and respects cancellation", async () => {
  const p = await browser.newPage();
  await p.route('https://source.example/**', r => r.fulfill({ contentType: 'text/html', body: '<a href="/a">Section A</a><a href="/b">Section B</a><a href="/c">Section C</a><a href="/d">Section D</a>' }));
  await p.goto('https://source.example/home');
  const model = { run: vi.fn(async (prompt: string) => JSON.stringify({ id: links(prompt).find(l => !l.visited)!.id, kind: 'section', reason: 'More navigation' })) };
  expect(await navigateExternalActivity(p, task, model, config)).toBe(false);
  expect(model.run).toHaveBeenCalledTimes(3);
  const controller = new AbortController(); controller.abort();
  await expect(navigateExternalActivity(p, task, model, { ...config, abortSignal: controller.signal })).rejects.toThrow();
  expect(model.run).toHaveBeenCalledTimes(3);
  await p.close();
}, 15000);

it("rejects cross-origin, credential, mutation and script destinations", () => {
  for (const href of ['https://other.example/task', 'https://user:secret@source.example/task', '/attempt.php', '/view?action=delete', 'javascript:submit()', 'mailto:teacher@example.com']) expect(safeNavigationHref(href, 'https://source.example')).toBe(false);
  for (const href of ['/task/8.4']) expect(safeNavigationHref(href, 'https://source.example')).toBe(true);
  expect(compatibleActivityIdentifier('8.4 Task ***', '8.40 Task ***')).toBe(false);
});

it("does not execute click handlers on script-only or ordinary HTTPS links", async () => {
  const p = await browser.newPage();
  let mutations = 0;
  await p.exposeFunction("recordMutation", () => { mutations++; });
  await p.route("https://source.example/**", r => r.fulfill({ contentType: "text/html", body:
    '<a href="#task" onclick="recordMutation()">8.4 - Task ***</a><a href="javascript:void(0)" onclick="recordMutation()">8.4 - Task ***</a><a href="/task" onclick="recordMutation()">8.4 - Task ***</a><main>Task metadata</main>' }));
  await p.goto("https://source.example/home");
  const model = { run: vi.fn() };
  expect(await navigateExternalActivity(p, task, model, config)).toBe(true);
  expect(p.url()).toBe("https://source.example/task");
  expect(mutations).toBe(0);
  expect(model.run).not.toHaveBeenCalled();
  await p.close();
}, 15000);

it("rejects optional cookies only within a recognized cookie dialog, never unrelated controls or acceptance", async () => {
  const p = await browser.newPage();
  await p.route('https://source.example/**', r => r.fulfill({ contentType: 'text/html', body: `<button onclick='window.other=true'>Reject All</button><div role='dialog'>Privacy and cookies. Optional cookies.<button onclick='window.accepted=true'>Accept All</button><button onclick='window.rejected=true;this.parentElement.remove()'>Reject All</button></div><script>window.other=false;window.accepted=false;window.rejected=false</script>` }));
  await p.goto('https://source.example/home');
  await rejectOptionalCookies(p);
  await rejectOptionalCookies(p);
  expect(await p.evaluate('({other:window.other,accepted:window.accepted,rejected:window.rejected})')).toEqual({ other: false, accepted: false, rejected: true });
  await p.close();
});

it("keeps semantic selection and independent review for ambiguous numbered targets", async () => {
  const p = await browser.newPage();
  await p.route('https://source.example/**', r => r.fulfill({ contentType: 'text/html', body: "<a href='/one'>8.4 - Worksheet ***</a><a href='/two'>8.4 - Review ***</a>" }));
  await p.goto('https://source.example/home');
  const model = { run: vi.fn(async (prompt: string) => prompt.startsWith('Independently')
    ? JSON.stringify({ matches: true, quote: '8.4 - Worksheet ***' })
    : JSON.stringify({ id: links(prompt)[0]!.id, kind: 'activity', reason: 'Source context identifies worksheet' })) };
  expect(await navigateExternalActivity(p, task, model, config)).toBe(true);
  expect(model.run).toHaveBeenCalledTimes(2);
  await p.close();
});
