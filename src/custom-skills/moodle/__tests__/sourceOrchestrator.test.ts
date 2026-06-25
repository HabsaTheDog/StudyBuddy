import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunDiagnostics } from "../runDiagnostics.js";
import { createSourceOrchestratorNode, createSourcePlannerNode } from "../sourceOrchestrator.js";
import { initialAgentState } from "../state.js";
import { moodleTestConfig } from "./support/moodleTestBlocks.js";

let runDir: string | null = null;

afterEach(async () => {
  if (runDir) {
    await rm(runDir, { recursive: true, force: true });
    runDir = null;
  }
});

describe("sourceOrchestrator", () => {
  it("runs Moodle and CIS concurrently when both are needed", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "source-orchestrator-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({
      runDir,
      prompt: "Bereite mich mit dem Kursmaterial auf die Prüfung morgen vor",
      cisUrls: ["https://cis.example/cis.php/Cis/MyLvPlan"],
      includeCis: true,
      diagnostics,
    });
    await createSourcePlannerNode(config)();
    const starts: Record<string, number> = {};
    const orchestrator = createSourceOrchestratorNode(config, {
      scraperNode: async () => {
        starts.moodle = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 40));
        await diagnostics.markSuccess("moodle", {
          detail: "Moodle ok.",
          urls: [config.moodleUrl],
          pages: 1,
        });
        return { moodle_raw_text: "MOODLE_TEXT", error_log: null };
      },
      cisScraperNode: async () => {
        starts.cis = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 40));
        await diagnostics.markSuccess("cis", {
          detail: "CIS ok.",
          urls: config.cisUrls,
          pages: 1,
        });
        return { moodle_raw_text: "CIS_TEXT", error_log: null };
      },
    });

    const result = await orchestrator(initialAgentState);

    expect(Math.abs(starts.moodle - starts.cis)).toBeLessThan(25);
    expect(result.moodle_raw_text).toContain("MOODLE_TEXT");
    expect(result.moodle_raw_text).toContain("CIS_TEXT");
  });

  it("does not erase successful CIS text when Moodle fails", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "source-orchestrator-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({
      runDir,
      prompt: "Bereite mich mit den Unterlagen auf die Prüfung morgen vor",
      cisUrls: ["https://cis.example/cis.php/Cis/MyLvPlan"],
      includeCis: true,
      diagnostics,
    });
    await createSourcePlannerNode(config)();
    const result = await createSourceOrchestratorNode(config, {
      scraperNode: async () => {
        throw new Error("Moodle unavailable");
      },
      cisScraperNode: async () => {
        await diagnostics.markSuccess("cis", {
          detail: "CIS ok.",
          urls: config.cisUrls,
          pages: 1,
        });
        return { moodle_raw_text: "CIS_TEXT", error_log: null };
      },
    })(initialAgentState);

    expect(result.moodle_raw_text).toContain("CIS_TEXT");
    expect(result.moodle_raw_text).toContain("Moodle crawl failed");
  });

  it("writes progress with the planned source coverage", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "source-orchestrator-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({
      runDir,
      prompt: "Wo ist morgen der Raum?",
      cisUrls: ["https://cis.example/cis.php/Cis/MyLvPlan"],
      includeCis: true,
      diagnostics,
    });
    await createSourcePlannerNode(config)();
    await createSourceOrchestratorNode(config, {
      cisScraperNode: async () => {
        await diagnostics.markSuccess("cis", {
          detail: "CIS ok.",
          urls: config.cisUrls,
          pages: 1,
        });
        return { moodle_raw_text: "CIS_TEXT", error_log: null };
      },
    })(initialAgentState);

    const progress = JSON.parse(await readFile(path.join(runDir, "run-progress.json"), "utf8"));
    expect(progress.sourcePlan.targets).toEqual(["cis"]);
    expect(progress.publicSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "moodle", status: "skipped" }),
      expect.objectContaining({ id: "cis", status: "done" }),
    ]));
  });
});
