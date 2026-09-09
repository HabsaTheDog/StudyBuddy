import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import { moodleTestConfig } from "./support/moodleTestBlocks.js";
const mocks = vi.hoisted(() => ({ read: vi.fn(), resolve: vi.fn() }));
vi.mock("../moodleInventory.js", async importOriginal => ({ ...await importOriginal<object>(),
  readEnrolledCourses: async () => ({ complete: true, courses: [
    { id: "course-1", courseId: 1, label: "Current course", url: "https://m.example/course/view.php?id=1", start: 1788213600, end: null },
    { id: "course-2", courseId: 2, label: "Old course", url: "https://m.example/course/view.php?id=2", start: 1700000000, end: null },
  ] }), readCourseActivities: mocks.read,
}));
vi.mock("../semanticSearch.js", () => ({ resolveSemanticSearch: mocks.resolve }));
import { auditObligationInventory } from "../obligationInventory.js";
const dirs: string[] = [];
afterEach(async () => { vi.clearAllMocks(); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function audit(historical = false) {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "obligation-scope-")); dirs.push(runDir);
  mocks.read.mockResolvedValue({ complete: true, text: "", activities: [] });
  const config = moodleTestConfig({ runDir, runtimeCacheDir: runDir, sourceMode: "moodle", originalUserPrompt: historical ? "Alle Deadlines, auch alte Kurse" : "Alle Deadlines aus allen Kursen" });
  return auditObligationInventory(config, {} as Page, { run: vi.fn().mockResolvedValue(JSON.stringify({ courseQuery: "", quote: "", includeOlder: historical, olderQuote: historical ? "auch alte Kurse" : "" })) });
}
it("audits every selected current course and records historical exclusions", async () => {
  mocks.resolve.mockResolvedValue({ status: "resolved", selectedIds: ["course-1"] });
  const result = await audit();
  expect(result.scope).toBe("current_semester");
  expect(result.courses).toEqual(expect.arrayContaining([expect.objectContaining({ id: 1, status: "audited" }), expect.objectContaining({ id: 2, status: "excluded" })]));
  expect(mocks.read.mock.calls.map(c => c[1].courseId)).toEqual([1]);
});
it("does not crawl historical enrollments or claim completeness when scope is ambiguous", async () => {
  mocks.resolve.mockResolvedValue({ status: "ambiguous", reason: "Missing term evidence", selectedIds: [] });
  const result = await audit();
  expect(result.complete).toBe(false);
  expect(result.gaps.join()).toContain("Missing term evidence");
  expect(mocks.read).not.toHaveBeenCalled();
});
it("audits the complete enrollment catalog after explicit historical inclusion", async () => {
  const result = await audit(true);
  expect(result.scope).toBe("all_enrolled");
  expect(result.courses.every(c => c.status === "audited")).toBe(true);
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(mocks.resolve).not.toHaveBeenCalled();
});
