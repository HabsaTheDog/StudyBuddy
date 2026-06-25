import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunDiagnostics } from "../runDiagnostics.js";
import { initialAgentState } from "../state.js";
import { discoverVisualCandidates } from "../visualAssets.js";
import { moodleTestConfig } from "./support/moodleTestBlocks.js";

let runDir: string | null = null;

afterEach(async () => {
  if (runDir) {
    await rm(runDir, { recursive: true, force: true });
    runDir = null;
  }
});

describe("visual asset discovery", () => {
  it("turns Moodle image artifacts into managed visual candidates", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-visuals-"));
    const sourcesDir = path.join(runDir, "sources");
    await mkdir(sourcesDir, { recursive: true });
    const sourceImage = path.join(sourcesDir, "schaltung.svg");
    await writeFile(
      sourceImage,
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="white"/><path d="M10 25 H90" stroke="black"/></svg>`,
      "utf8",
    );
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    await diagnostics.updateCoverage("moodle", {
      status: "success",
      detail: "Downloaded source image.",
      urls: ["https://moodle.example/course"],
      pages: 1,
      artifacts: [sourceImage],
    });

    const manifest = await discoverVisualCandidates(
      moodleTestConfig({
        runDir,
        diagnostics,
        prompt: "Erstelle ein Elektrotechnik Lern-PDF mit Schaltung und Messaufbau",
      }),
      {
        ...initialAgentState,
        moodle_raw_text: "Schaltung Messaufbau Spannung Strom",
      },
    );

    expect(manifest.candidates).toHaveLength(1);
    expect(manifest.candidates[0]).toMatchObject({
      kind: "moodle_pdf_image",
      relative_path: expect.stringMatching(/^assets\/visuals\//),
      confidence: expect.any(Number),
    });
    await expect(readFile(path.join(runDir, manifest.candidates[0].relative_path), "utf8")).resolves.toContain("<svg");
  });
});
