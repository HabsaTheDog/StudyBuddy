import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverQuizTarget } from "../nodes/quizReviewNode.js";
import { quizDateGate } from "../quizTargetDate.js";
import { resolveTemporalRequest } from "../../temporalRequest.js";
import type { AgentBrowserClient } from "../agentBrowserClient.js";
import type { MoodleRuntimeConfig } from "../types.js";
import type { QuizMetadata } from "../quizSafetyPolicy.js";

const now = new Date("2026-09-08T14:53:13Z");
const base = "https://moodle.example";
describe("dated quiz target integrity", () => {
  it("keeps a real title over an empty duplicate and selects the date-confirmed quiz", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "quiz-date-"));
    let current = `${base}/course/view.php?id=1`;
    const opened: string[] = [];
    const client = {
      open: async (url: string) => { current = url; opened.push(url); }, wait: async () => {},
      snapshot: async () => ({ origin: current, refs: {}, snapshot: [
        `link "Minitest 1 (Wiederholung)" [ref=one, url=${base}/mod/quiz/view.php?id=101]`,
        `link "" [ref=empty, url=${base}/mod/quiz/view.php?id=101]`,
        `link "Minitest 2 (Fourierreihen)" [ref=two, url=${base}/mod/quiz/view.php?id=102]`,
      ].join("\n") }),
      evalJson: async () => ({ closesAt: current.endsWith("101") ? "2026-09-09T21:59:00Z" : "2026-09-15T21:59:00Z" }),
    } as unknown as AgentBrowserClient;
    try {
      const target = await discoverQuizTarget({ prompt: "kannst du den morgigen minitest für mathe machen?", temporalRequest: resolveTemporalRequest("morgigen", now), moodleUrl: current, baseUrl: base, maxPages: 24, runDir: dir } as MoodleRuntimeConfig, client);
      expect(target).toBe(`${base}/mod/quiz/view.php?id=101`);
      const candidates = JSON.parse(await readFile(path.join(dir, "quiz-candidates.json"), "utf8"));
      expect(candidates.find((c: {url:string}) => c.url.endsWith("101")).title).toBe("Minitest 1 (Wiederholung)");
      expect(opened.every(url => !/attempt|startattempt/.test(url))).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("blocks a direct approved URL when the original date does not match", () => {
    const config = { prompt: `bearbeite Quiz ${base}/mod/quiz/view.php?id=102`, originalUserPrompt: "morgigen minitest", temporalRequest: resolveTemporalRequest("morgigen", now) } as MoodleRuntimeConfig;
    expect(quizDateGate(config, { closesAt: "2026-09-15T21:59:00Z", opensAt: null } as QuizMetadata)).toMatchObject({ status: "blocked", reason: "quiz-target-date-unconfirmed" });
    expect(quizDateGate(config, { closesAt: null, opensAt: null } as QuizMetadata)?.status).toBe("blocked");
    expect(quizDateGate(config, { closesAt: "2026-09-09T21:59:00Z", opensAt: null } as QuizMetadata)).toBeNull();
  });
});
