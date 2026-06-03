import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeConfig } from "../config.js";

let tempRoot: string | null = null;

afterEach(async () => {
  vi.unstubAllEnvs();
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe("createRuntimeConfig", () => {
  it("rejects missing required input", () => {
    expect(() => createRuntimeConfig({ prompt: " ", moodleUrl: "https://moodle.example/course" })).toThrow(
      "prompt is required.",
    );
    expect(() => createRuntimeConfig({ prompt: "make notes", moodleUrl: " " })).toThrow("moodleUrl is required.");
  });

  it("normalizes explicit output paths and honors runtime overrides", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-config-"));
    const outputPath = path.join(tempRoot, "nested", "document.typ");
    vi.stubEnv("MOODLE_BASE_URL", "https://moodle.example");
    vi.stubEnv("MOODLE_DASHBOARD_URL", "https://moodle.example/my");
    vi.stubEnv("MOODLE_USERNAME", "student");
    vi.stubEnv("MOODLE_PASSWORD", "secret");
    vi.stubEnv("MOODLE_STORAGE_STATE", "/tmp/storage-state.json");
    vi.stubEnv("MOODLE_HEADLESS", "false");

    const config = createRuntimeConfig({
      prompt: "make notes",
      moodleUrl: "https://moodle.example/course/view.php?id=42",
      outputPath,
      maxDepth: 0,
      maxPages: 3,
      allowFileDownloads: false,
    });

    expect(config).toMatchObject({
      prompt: "make notes",
      moodleUrl: "https://moodle.example/course/view.php?id=42",
      outputPath: path.resolve(outputPath),
      runDir: path.dirname(path.resolve(outputPath)),
      maxDepth: 0,
      maxPages: 3,
      allowFileDownloads: false,
      baseUrl: "https://moodle.example",
      dashboardUrl: "https://moodle.example/my",
      username: "student",
      password: "secret",
      storageState: "/tmp/storage-state.json",
      headless: false,
    });
  });

  it("creates a timestamped run directory under MOODLE_OUTPUT_DIR by default", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-output-"));
    vi.stubEnv("MOODLE_OUTPUT_DIR", tempRoot);
    vi.stubEnv("MOODLE_BASE_URL", "");
    vi.stubEnv("MOODLE_DASHBOARD_URL", "");
    vi.stubEnv("MOODLE_HEADLESS", "true");

    const config = createRuntimeConfig({
      prompt: "make notes",
      moodleUrl: "https://moodle.example/course/view.php?id=42",
    });

    expect(config.outputPath).toBe(path.join(config.runDir, "document.typ"));
    expect(path.dirname(config.runDir)).toBe(path.resolve(tempRoot));
    expect(config.maxDepth).toBe(1);
    expect(config.maxPages).toBe(12);
    expect(config.allowFileDownloads).toBe(true);
    expect(config.baseUrl).toBe("https://moodle.example");
    expect(config.dashboardUrl).toBe("https://moodle.example/course/view.php?id=42");
    expect(config.headless).toBe(true);
  });
});
