import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverQuizTarget } from "../nodes/quizReviewNode.js";
import type { AgentBrowserClient } from "../agentBrowserClient.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { createPlaywrightBrowserClient } from "../playwrightBrowserClient.js";

const origin = "https://moodle.example";
const course = `${origin}/course/view.php?id=30`;
const other = `${origin}/course/view.php?id=20`;
const quiz = `${origin}/mod/quiz/view.php?id=301`;
let runDir: string;
afterEach(async () => { if (runDir) await rm(runDir, { recursive: true, force: true }); });

async function fixture(entry: string, prompt = "kannst du meinen minitest 1 in maes3 machen?") {
  runDir = await mkdtemp(path.join(os.tmpdir(), "quiz-course-scope-"));
  let current = entry;
  const opened: string[] = [];
  const courses = [
    { id: "20", label: "BMR-WS2026-MAES2-DE", url: other },
    { id: "30", label: "BMR-WS2026-MAES3-DE", url: course },
  ];
  const client = {
    open: async (url: string) => { current = url; opened.push(url); },
    wait: async () => {},
    enrolledCourses: vi.fn(async () => ({ courses, complete: true, method: "enrolled_api" })),
    evalJson: async () => "BMR-WS2026-MAES3-DE course content",
    snapshot: async () => ({ origin: current, refs: {}, snapshot: [
      `link "Study information" [ref=info, url=${origin}/course/view.php?id=999]`,
      ...courses.map(c => `link "${c.label}" [ref=c${c.id}, url=${c.url}]`),
      ...(current.startsWith(course) ? [`link "Minitest 1" [ref=q1, url=${quiz}]`] : []),
    ].join("\n") }),
  } as unknown as AgentBrowserClient;
  const config = { prompt, originalUserPrompt: prompt, moodleUrl: entry, dashboardUrl: `${origin}/my/`, baseUrl: origin, runDir, maxPages: 24 } as MoodleRuntimeConfig;
  const model = { run: vi.fn(async () => JSON.stringify({ action: "resolve", ids: ["30"], query: "", reason: "Exact requested course code", evidence: [{ id: "30", quote: courses[1].label }] })) };
  model.run.mockResolvedValueOnce(JSON.stringify({ action: "inspect", ids: ["30"], query: "", reason: "Verify requested course", evidence: [] }));
  return { config, client, model, opened };
}

describe("quiz discovery course scope", () => {
  it("reads real browser course text through the JSON boundary before selecting the quiz", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html");
      response.end('<main>Applied mathematics ABC42 <a href="/mod/quiz/view.php?id=301">Minitest 1</a></main>');
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const local = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { config } = await fixture(`${local}/`, "Bearbeite Minitest 1 in ABC42");
    const client = createPlaywrightBrowserClient({ ...config, headless: true, baseUrl: local, dashboardUrl: `${local}/` });
    client.enrolledCourses = async () => ({ courses: [{ id: "30", courseId: 30, label: "Applied mathematics ABC42", url: `${local}/course/view.php?id=30`, start: null, end: null }], complete: true, method: "fixture" });
    const model = { run: vi.fn(async () => JSON.stringify({ action: "resolve", ids: ["30"], query: "", reason: "Verified course", evidence: [{ id: "30", quote: "Applied mathematics ABC42" }] })) };
    model.run.mockResolvedValueOnce(JSON.stringify({ action: "inspect", ids: ["30"], query: "", reason: "Read course", evidence: [] }));
    try {
      expect(await discoverQuizTarget({ ...config, baseUrl: local }, client, model)).toBe(`${local}/mod/quiz/view.php?id=301`);
      expect(model.run).toHaveBeenCalledTimes(2);
    } finally {
      await client.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it.each(["/", "/my/", "/my/courses.php"])("resolves the enrolled catalog from %s and never follows global course navigation", async entry => {
    const { config, client, model, opened } = await fixture(`${origin}${entry}`);
    expect(await discoverQuizTarget(config, client, model)).toBe(quiz);
    expect(client.enrolledCourses).toHaveBeenCalledOnce();
    expect(opened).toEqual([course, course]);
  });

  it("does not broaden an unresolved course into an arbitrary numbered quiz", async () => {
    const { config, client, model, opened } = await fixture(`${origin}/`);
    model.run.mockReset().mockResolvedValue(JSON.stringify({ action: "clarify", ids: [], query: "", reason: "Two courses are plausible", evidence: [] }));
    expect(await discoverQuizTarget(config, client, model)).toBeNull();
    expect(opened).toEqual([]);
  });

  it("keeps a directly supplied course scoped without model resolution", async () => {
    const { config, client, model, opened } = await fixture(course);
    expect(await discoverQuizTarget(config, client, model)).toBe(quiz);
    expect(client.enrolledCourses).not.toHaveBeenCalled();
    expect(opened).toEqual([course]);
  });

  it.each(["maes3", "abc42"])("matches the complete requested code %s without a curriculum table", async code => {
    const { config, client, opened } = await fixture(`${origin}/`, `Bearbeite Minitest 1 in ${code}`);
    const snapshot = client.snapshot.bind(client);
    client.snapshot = async () => {
      const result = await snapshot();
      return { ...result, snapshot: result.snapshot.replaceAll("MAES3", code.toUpperCase()).replaceAll("MAES2", `${code.toUpperCase()}0`) };
    };
    expect(await discoverQuizTarget(config, client)).toBe(quiz);
    expect(opened).toEqual([`${origin}/`, course]);
  });
});
