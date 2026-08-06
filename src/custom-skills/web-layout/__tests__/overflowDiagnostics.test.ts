import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { minimalValidStudyBuddyHtml } from "../htmlShell.js";
import { validateWebLayoutHtml } from "../validation.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("responsive repair diagnostics", () => {
  it("reports the offending selector and measured overflow", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-overflow-diagnostics-"));
    tempDirs.push(runDir);
    const html = minimalValidStudyBuddyHtml({
      title: "Overflow diagnostics",
      kind: "flashcards",
      language: "de",
    }).replace("</main>", '<div id="forced-overflow" style="width:900px">wide</div></main>');

    const report = await validateWebLayoutHtml(html, "flashcards", { runDir });
    const overflow = report.issues.find((issue) => issue.code === "horizontal-overflow");
    expect(report.ok).toBe(false);
    expect(overflow?.details?.pageOverflow).toBeTypeOf("number");
    expect(JSON.stringify(overflow?.details?.offenders)).toContain("forced-overflow");
  });
});
