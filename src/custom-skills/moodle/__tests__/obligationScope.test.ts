import { expect, it, vi } from "vitest";
import { resolveObligationScope, formatObligationInventory } from "../obligationInventory.js";
import { moodleTestConfig } from "./support/moodleTestBlocks.js";

const scope = (prompt: string, value: unknown) => resolveObligationScope(moodleTestConfig({ originalUserPrompt: prompt }), { run: vi.fn().mockResolvedValueOnce(JSON.stringify(value)).mockResolvedValueOnce(JSON.stringify({ decision: "restriction", quote: prompt })) }, []);
const broad = { courseQuery: "", quote: "", includeOlder: false, olderQuote: "" };
it("defaults broad all-course requests to current term with source-based membership", async () => {
  const result = await scope("Alle Deadlines aus allen meinen Kursen bis morgen", broad);
  expect(result.kind).toBe("current_semester");
  expect(result.query).toContain("missing end date does not establish current membership");
  expect(result.error).toBeUndefined();
});
it("supports explicit historical opt-in and named historical subjects", async () => {
  expect(await scope("Alle Deadlines, auch alte Kurse", { ...broad, includeOlder: true, olderQuote: "auch alte Kurse" })).toEqual({ kind: "all_enrolled", query: "" });
  expect(await scope("Statik aus dem letzten Semester", { ...broad, courseQuery: "Statik aus dem letzten Semester", quote: "Statik aus dem letzten Semester" })).toEqual({ kind: "requested_course", query: "Statik aus dem letzten Semester" });
});
it("never broadens scope from an invented opt-in or malformed response", async () => {
  for (const value of [{ ...broad, includeOlder: true, olderQuote: "auch alte Kurse" }, { ...broad, courseQuery: "History", quote: "History" }, { courseQuery: "" }]) {
    expect(await scope("Deadlines bis morgen", value)).toMatchObject({ kind: "current_semester", error: expect.any(String) });
  }
});
it("preserves historical request evidence even when combined with a subject", async () => {
  expect(await scope("Alle Aufgaben in Mathe", { ...broad, courseQuery: "Mathe", quote: "Mathe", includeOlder: true, olderQuote: "alte Kurse" })).toHaveProperty("error");
});
it("makes the audited semester scope visible rather than implying all enrollments", () => {
  const answer = formatObligationInventory({ schemaVersion: 1, complete: true, scope: "current_semester", range: null, courses: [], facts: [], gaps: [], answer: "" }, "de", "Europe/Vienna");
  expect(answer).toContain("Prüfumfang: aktuelles Semester; ältere Kurse nur auf ausdrücklichen Wunsch");
});

it("does not narrow an explicit all-enrollment request to an included course category", async () => {
  const prompt = "Alle meine Einschreibungen, ausdrücklich auch ältere Semester und allgemeine Infokurse";
  const run = vi.fn().mockResolvedValueOnce(JSON.stringify({ courseQuery: "allgemeine Infokurse", quote: "allgemeine Infokurse", includeOlder: true, olderQuote: "ältere Semester" }))
    .mockResolvedValueOnce(JSON.stringify({ decision: "unrestricted", quote: prompt }));
  expect(await resolveObligationScope(moodleTestConfig({ originalUserPrompt: prompt }), { run }, [])).toEqual({ kind: "all_enrolled", query: "" });
  expect(run).toHaveBeenCalledTimes(2);
});
it("retains the default semester when a category is merely an inclusion without historical opt-in", async () => {
  const prompt = "Alle Aufgaben, auch aus Infokursen";
  const run = vi.fn().mockResolvedValueOnce(JSON.stringify({ ...broad, courseQuery: "Infokursen", quote: "Infokursen" }))
    .mockResolvedValueOnce(JSON.stringify({ decision: "unrestricted", quote: prompt }));
  expect(await resolveObligationScope(moodleTestConfig({ originalUserPrompt: prompt }), { run }, [])).toMatchObject({ kind: "current_semester" });
});
it("does not broaden ambiguous or unverified restrictive requests", async () => {
  for (const review of [{ decision: "ambiguous", quote: "Mathe und Physik" }, { decision: "unrestricted", quote: "invented" }]) {
    const run = vi.fn().mockResolvedValueOnce(JSON.stringify({ ...broad, courseQuery: "Mathe", quote: "Mathe" })).mockResolvedValueOnce(JSON.stringify(review));
    expect(await resolveObligationScope(moodleTestConfig({ originalUserPrompt: "Mathe und Physik" }), { run }, [])).toHaveProperty("error");
  }
});
it("preserves a whole-request category restriction", async () => {
  expect(await scope("Nur allgemeine Infokurse", { ...broad, courseQuery: "allgemeine Infokurse", quote: "allgemeine Infokurse" })).toEqual({ kind: "requested_course", query: "allgemeine Infokurse" });
});

it("passes explicit historical inclusion along with a named subject restriction", async () => {
  expect(await scope("Alle Mathe-Aufgaben, auch ältere Semester", { courseQuery: "Mathe", quote: "Mathe", includeOlder: true, olderQuote: "ältere Semester" })).toEqual({ kind: "requested_course", query: "Mathe", includeOlder: true });
});
