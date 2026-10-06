import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestedQuizCount, resolveQuizTargets } from "../quizTargets.js";
import type { AgentBrowserClient } from "../agentBrowserClient.js";
import type { MoodleRuntimeConfig } from "../types.js";

const origin = "https://moodle.example";
const course = `${origin}/course/view.php?id=30`;
const quiz = (id: number) => `${origin}/mod/quiz/view.php?id=${id}`;
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function fixture(prompt: string, statuses: Array<"open" | "attempts_exhausted" | "active"> = ["attempts_exhausted", "open", "open"]) {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "quiz-targets-"));
  directories.push(runDir);
  let current = course;
  const client = {
    open: vi.fn(async (url: string) => { current = url; }),
    wait: async () => {},
    snapshot: async () => ({ origin: current, refs: {}, snapshot: statuses.map((_status, i) => `link "Minitest ${i + 1}" [ref=q${i + 1}, url=${quiz(i + 1)}]`).join("\n") }),
    evalJson: async () => {
      const status = statuses[Number(new URL(current).searchParams.get("id")) - 1];
      return {
        availabilityStatus: status === "active" ? "open" : status,
        hasActiveAttempt: status === "active", canStartNewAttempt: status === "open",
        attemptsLeft: status === "attempts_exhausted" ? 0 : 2,
        attemptsAllowed: 2, attemptsUsed: status === "attempts_exhausted" ? 2 : 0,
        timeLimitUnlimited: true,
      };
    },
  } as unknown as AgentBrowserClient;
  const config = { prompt, originalUserPrompt: prompt, moodleUrl: course,
    dashboardUrl: `${origin}/my/`, baseUrl: origin, runDir, maxPages: 5 } as MoodleRuntimeConfig;
  return { config, client };
}

describe("quiz target batches", () => {
  it.each([
    ["Bearbeite zwei Mini-Tests", 2], ["Löse die 2 offenen Tests", 2],
    ["I have quizzes. Complete both", 2], ["Mach alle offenen Quizzes", null],
    ["Löse alle Fragen in Minitest 2", 1], ["Bearbeite Minitest 2", 1],
  ])("counts %s", (prompt, expected) => {
    expect(requestedQuizCount(prompt as string)).toBe(expected);
  });

  it("uses exactly the explicit URLs without discovery or metadata navigation", async () => {
    const { config, client } = await fixture(`Löse alle Quizzes ${quiz(2)} und ${quiz(3)}`);
    expect(await resolveQuizTargets(config, client)).toEqual([quiz(2), quiz(3)]);
    expect(client.open).not.toHaveBeenCalled();
  });

  it("skips exhausted attempts and selects both requested quizzes in one discovery", async () => {
    const { config, client } = await fixture("Bitte die zwei Mini-Tests erledigen");
    expect(await resolveQuizTargets(config, client)).toEqual([quiz(2), quiz(3)]);
    expect(vi.mocked(client.open).mock.calls.filter(([url]) => url === course)).toHaveLength(1);
  });

  it("prefers a resumable attempt for an unspecified single quiz", async () => {
    const { config, client } = await fixture("Bearbeite den Minitest", ["open", "active"]);
    expect(await resolveQuizTargets(config, client)).toEqual([quiz(2)]);
  });

  it("does not substitute a different quiz when the numbered target is exhausted", async () => {
    const { config, client } = await fixture("Bearbeite Minitest 1");
    expect(await resolveQuizTargets(config, client)).toEqual([]);
  });

  it("records missing targets instead of calling a half-filled request complete", async () => {
    const { config, client } = await fixture("Bitte beide Mini-Tests erledigen", ["attempts_exhausted", "open"]);
    expect(await resolveQuizTargets(config, client)).toEqual([quiz(2)]);
    expect(JSON.parse(await readFile(path.join(config.runDir, "quiz-targets.json"), "utf8"))).toMatchObject({
      requestedCount: 2, missingCount: 1, status: "partial",
    });
  });

  it("selects all available matching quizzes without broadening the course", async () => {
    const { config, client } = await fixture("Bearbeite alle Mini-Tests");
    expect(await resolveQuizTargets(config, client)).toEqual([quiz(2), quiz(3)]);
    expect(JSON.parse(await readFile(path.join(config.runDir, "quiz-targets.json"), "utf8"))).toMatchObject({ requestedCount: null });
  });
});
