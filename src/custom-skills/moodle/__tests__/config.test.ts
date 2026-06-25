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

  it("creates a request-specific run directory under the selected workspace", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-output-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);
    vi.stubEnv("MOODLE_BASE_URL", "");
    vi.stubEnv("MOODLE_DASHBOARD_URL", "");
    vi.stubEnv("MOODLE_HEADLESS", "true");

    const config = createRuntimeConfig({
      prompt: "make notes",
      moodleUrl: "https://moodle.example/course/view.php?id=42",
    });

    expect(config.outputPath).toBe(path.join(config.runDir, "document.typ"));
    expect(path.dirname(config.runDir)).toBe(path.join(tempRoot, "output", "make-notes"));
    expect(config.maxDepth).toBe(2);
    expect(config.maxPages).toBe(8);
    expect(config.allowFileDownloads).toBe(true);
    expect(config.idleTimeoutMs).toBe(8 * 60_000);
    expect(config.baseUrl).toBe("https://moodle.example");
    expect(config.dashboardUrl).toBe("https://moodle.example/course/view.php?id=42");
    expect(config.headless).toBe(true);
  });

  it("can explicitly disable CIS even when CIS_URLS is configured", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-no-cis-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);
    vi.stubEnv("CIS_URLS", "https://cis.example/cis.php");

    const config = createRuntimeConfig({
      prompt: "make notes",
      moodleUrl: "https://moodle.example/course/view.php?id=42",
      includeCis: false,
    });

    expect(config.includeCis).toBe(false);
    expect(config.cisUrls).toEqual([]);
  });

  it("applies visual asset defaults and environment overrides", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-visual-config-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);
    vi.stubEnv("STUDY_BUDDY_VISUALS_MAX", "5");
    vi.stubEnv("STUDY_BUDDY_VISUALS_MIN_CONFIDENCE", "0.4");

    const config = createRuntimeConfig({
      prompt: "make notes",
      moodleUrl: "https://moodle.example/course/view.php?id=42",
    });

    expect(config.visualsEnabled).toBe(true);
    expect(config.maxVisualAssets).toBe(5);
    expect(config.visualMinConfidence).toBe(0.4);
  });

  it("uses a direct Moodle URL from the prompt when the configured URL is the dashboard", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-prompt-url-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);

    const config = createRuntimeConfig({
      prompt: "bearbeite das Moodle Quiz https://moodle.technikum-wien.at/mod/quiz/view.php?id=2249517",
      moodleUrl: "https://moodle.technikum-wien.at/my/",
    });

    expect(config.moodleUrl).toBe("https://moodle.technikum-wien.at/mod/quiz/view.php?id=2249517");
    expect(config.dashboardUrl).toBe("https://moodle.technikum-wien.at/my/");
  });

  it("keeps explicit configured activity URLs ahead of URLs mentioned in the prompt", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-explicit-url-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);

    const config = createRuntimeConfig({
      prompt: "vergleiche mit https://moodle.technikum-wien.at/mod/quiz/view.php?id=2249517",
      moodleUrl: "https://moodle.technikum-wien.at/course/view.php?id=32916",
    });

    expect(config.moodleUrl).toBe("https://moodle.technikum-wien.at/course/view.php?id=32916");
  });

  it("constrains direct quiz attempt pages to a single-page crawl by default", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-attempt-url-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);

    const config = createRuntimeConfig({
      prompt: "bearbeite diese Seite https://moodle.technikum-wien.at/mod/quiz/attempt.php?attempt=1974633&cmid=2185215&page=8",
      moodleUrl: "https://moodle.technikum-wien.at/my/",
    });

    expect(config.moodleUrl).toBe(
      "https://moodle.technikum-wien.at/mod/quiz/attempt.php?attempt=1974633&cmid=2185215&page=8",
    );
    expect(config.maxDepth).toBe(0);
    expect(config.maxPages).toBe(1);
  });
});
