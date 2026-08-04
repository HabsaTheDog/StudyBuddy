import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeConfig, sanitizeConfig } from "../config.js";

let tempRoot: string | null = null;

afterEach(async () => {
  vi.unstubAllEnvs();
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe("createRuntimeConfig", () => {
  it("resolves artifact language from the prompt unless explicitly overridden", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-language-config-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);
    const english = createRuntimeConfig({
      prompt: "Make me a PDF about dynamics",
      moodleUrl: "https://moodle.example/course",
    });
    const overridden = createRuntimeConfig({
      prompt: "Create a study guide",
      moodleUrl: "https://moodle.example/course",
      outputLanguage: "de",
    });
    const translatedTaskPrompt = createRuntimeConfig({
      prompt: "Bearbeite den ersten Selbsttest in Elektrotechnik 2",
      originalUserPrompt: "Can you do the first self quiz in Elektrotechnik 2 for me?",
      moodleUrl: "https://moodle.example/course",
    });

    expect(english).toMatchObject({ outputLanguage: "en", outputLanguageReason: "prompt_language" });
    expect(sanitizeConfig(english)).toMatchObject({ outputLanguage: "en" });
    expect(overridden).toMatchObject({ outputLanguage: "de", outputLanguageReason: "explicit_option" });
    expect(translatedTaskPrompt).toMatchObject({
      originalUserPrompt: "Can you do the first self quiz in Elektrotechnik 2 for me?",
      outputLanguage: "en",
      outputLanguageReason: "prompt_language",
    });
    expect(sanitizeConfig(translatedTaskPrompt)).toMatchObject({
      prompt: "Bearbeite den ersten Selbsttest in Elektrotechnik 2",
      originalUserPrompt: "Can you do the first self quiz in Elektrotechnik 2 for me?",
      outputLanguage: "en",
    });
  });

  it("rejects missing required input", () => {
    expect(() => createRuntimeConfig({ prompt: " ", moodleUrl: "https://moodle.example/course" })).toThrow(
      "prompt is required.",
    );
    expect(() => createRuntimeConfig({ prompt: "make notes", moodleUrl: " " })).toThrow("moodleUrl is required.");
    expect(() => createRuntimeConfig({
      prompt: "make notes",
      originalUserPrompt: " ",
      moodleUrl: "https://moodle.example/course",
    })).toThrow("originalUserPrompt must not be empty");
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
      dashboardUrl: "https://moodle.example/my/",
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
    expect(path.dirname(config.runDir)).toBe(
      path.join(tempRoot, "study-buddy-data", "runs", "make-notes"),
    );
    expect(config.maxDepth).toBe(2);
    expect(config.maxPages).toBe(8);
    expect(config.allowFileDownloads).toBe(true);
    expect(config.idleTimeoutMs).toBe(8 * 60_000);
    expect(config.baseUrl).toBe("https://moodle.example");
    expect(config.dashboardUrl).toBe("https://moodle.example/course/view.php?id=42");
    expect(config.headless).toBe(true);
  });

  it("switches from a configured dashboard to a direct course URL on any Moodle installation", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-portable-config-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);
    vi.stubEnv("MOODLE_BASE_URL", "");
    vi.stubEnv("MOODLE_DASHBOARD_URL", "");

    const config = createRuntimeConfig({
      prompt: "Create a guide from https://learn.example.edu/course/view.php?id=77",
      moodleUrl: "https://default-moodle.example/my/",
    });

    expect(config.moodleUrl).toBe("https://learn.example.edu/course/view.php?id=77");
    expect(config.baseUrl).toBe("https://learn.example.edu");
    expect(config.dashboardUrl).toBe("https://learn.example.edu/my/");
  });

  it("preserves a subdirectory Moodle installation when switching from another dashboard", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-subpath-config-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);
    vi.stubEnv("MOODLE_BASE_URL", "");
    vi.stubEnv("MOODLE_DASHBOARD_URL", "");

    const config = createRuntimeConfig({
      prompt: "Create a guide from https://portal.example.edu/learning/moodle/course/view.php?id=77",
      moodleUrl: "https://default-moodle.example/my/",
    });

    expect(config.moodleUrl).toBe(
      "https://portal.example.edu/learning/moodle/course/view.php?id=77",
    );
    expect(config.baseUrl).toBe("https://portal.example.edu");
    expect(config.dashboardUrl).toBe("https://portal.example.edu/learning/moodle/my/");
  });

  it("uses an explicit Codex model over the inherited Study Buddy model", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-model-config-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);
    vi.stubEnv("STUDY_BUDDY_CODEX_MODEL", "gpt-env");

    const config = createRuntimeConfig({
      prompt: "make notes",
      moodleUrl: "https://moodle.example/course/view.php?id=42",
      codexModel: "gpt-selected",
    });

    expect(config.codexModel).toBe("gpt-selected");
    expect(sanitizeConfig(config).codexModel).toBe("gpt-selected");
  });

  it("reads execution profile and reasoning effort overrides", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-profile-config-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);
    vi.stubEnv("STUDY_BUDDY_EXECUTION_PROFILE", "fast");
    vi.stubEnv("STUDY_BUDDY_CODEX_REASONING_EFFORT", "none");

    const config = createRuntimeConfig({
      prompt: "make notes",
      moodleUrl: "https://moodle.example/course/view.php?id=42",
    });

    expect(config.executionProfile).toBe("fast");
    expect(config.codexReasoningEffort).toBe("minimal");
    expect(sanitizeConfig(config)).toMatchObject({
      executionProfile: "fast",
      codexReasoningEffort: "minimal",
    });
  });

  it("keeps Codex executable overrides explicit and sanitizes the path", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-codex-runtime-config-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);
    vi.stubEnv("STUDY_BUDDY_CODEX_PATH", "/opt/codex-preview/bin/codex");
    vi.stubEnv("STUDY_BUDDY_CODEX_COMPATIBILITY_FALLBACK_MODEL", "gpt-compatible");
    vi.stubEnv("STUDY_BUDDY_CODEX_PREFLIGHT", "version-only");

    const config = createRuntimeConfig({
      prompt: "make notes",
      moodleUrl: "https://moodle.example/course/view.php?id=42",
    });
    const sanitized = sanitizeConfig(config);

    expect(config.codexPath).toBe("/opt/codex-preview/bin/codex");
    expect(config.codexCompatibilityFallbackModel).toBe("gpt-compatible");
    expect(config.codexPreflightMode).toBe("version-only");
    expect(config.codexModelExplicit).toBe(false);
    expect(sanitized).toMatchObject({
      codexBinarySource: "override",
      codexCompatibilityFallbackModel: "gpt-compatible",
      codexPreflightMode: "version-only",
    });
    expect(JSON.stringify(sanitized)).not.toContain("/opt/codex-preview/bin/codex");
  });

  it("keeps the staged PDF workflow inside the default fifteen-minute budget", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-artifact-timeout-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);

    const extractionConfig = createRuntimeConfig({
      prompt: "Create a study guide for the MEL exam",
      moodleUrl: "https://moodle.example/course/view.php?id=42",
      stage: "extract",
    });
    const renderConfig = createRuntimeConfig({
      prompt: "Create a study guide for the MEL exam",
      moodleUrl: "https://moodle.example/course/view.php?id=42",
      stage: "render",
      sourceRunDir: tempRoot,
    });

    expect(extractionConfig.maxRuntimeMs).toBe(14 * 60_000);
    expect(extractionConfig.idleTimeoutMs).toBe(5 * 60_000);
    expect(renderConfig.maxRuntimeMs).toBe(1 * 60_000);
    expect(renderConfig.idleTimeoutMs).toBe(5 * 60_000);
  });

  it("collects visuals inline by default for document artifact extraction", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-artifact-visuals-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);

    const extractionConfig = createRuntimeConfig({
      prompt: "Create a study guide for the MEL exam",
      moodleUrl: "https://moodle.example/course/view.php?id=42",
      stage: "extract",
    });
    const deferredConfig = createRuntimeConfig({
      prompt: "Create a study guide for the MEL exam",
      moodleUrl: "https://moodle.example/course/view.php?id=42",
      stage: "extract",
      visualMode: "deferred",
    });

    expect(extractionConfig.visualMode).toBe("inline");
    expect(extractionConfig.visualsEnabled).toBe(true);
    expect(deferredConfig.visualMode).toBe("deferred");
    expect(deferredConfig.visualsEnabled).toBe(false);
  });

  it("lets stage-specific runtime environment settings override artifact defaults", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-stage-timeout-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);
    vi.stubEnv("MOODLE_EXTRACT_MAX_RUNTIME_MS", "3600000");
    vi.stubEnv("MOODLE_EXTRACT_IDLE_TIMEOUT_MS", "1200000");

    const config = createRuntimeConfig({
      prompt: "Create a study guide for the MEL exam",
      moodleUrl: "https://moodle.example/course/view.php?id=42",
      stage: "extract",
    });

    expect(config.maxRuntimeMs).toBe(60 * 60_000);
    expect(config.idleTimeoutMs).toBe(20 * 60_000);
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

  it("keeps the private calendar URL out of sanitized run config", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-calendar-config-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);
    const config = createRuntimeConfig({
      prompt: "Wann ist die MEL1 Prüfung?",
      moodleUrl: "https://moodle.example/my/",
      calendarUrl: "https://calendar.example/private-token",
    });

    const serialized = JSON.stringify(sanitizeConfig(config));
    expect(serialized).toContain('"hasCalendarUrl":true');
    expect(serialized).not.toContain("private-token");
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
    expect(config.visualCropMode).toBe("auto");
  });

  it("reads quiz safety policy from environment settings", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-quiz-policy-config-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);
    vi.stubEnv("MOODLE_QUIZ_AUTO_ANSWER", "true");
    vi.stubEnv("MOODLE_QUIZ_REQUIRE_MANUAL_REVIEW", "false");
    vi.stubEnv("MOODLE_QUIZ_BLOCK_FINAL_SUBMIT", "false");
    vi.stubEnv("MOODLE_QUIZ_DRAFT_ONLY", "false");

    const config = createRuntimeConfig({
      prompt: "bearbeite das Moodle Quiz",
      moodleUrl: "https://moodle.example/mod/quiz/view.php?id=42",
    });

    expect(config.autoAnswer).toBe(true);
    expect(config.quizPolicy).toMatchObject({
      requestedAutoAnswer: true,
      settingAutoAnswer: true,
      requireManualReview: false,
      blockFinalSubmit: false,
      draftOnly: false,
      allowAttemptOpen: true,
      allowAnswerFill: true,
      allowFinalSubmit: false,
    });
  });

  it("forces quiz discovery to remain read-only even when auto-answer is enabled globally", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-quiz-discovery-config-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);
    vi.stubEnv("MOODLE_QUIZ_AUTO_ANSWER", "true");
    vi.stubEnv("MOODLE_QUIZ_OPEN_ATTEMPTS", "true");

    const config = createRuntimeConfig({
      prompt: "Find Moodle quizzes and self-checks that are still open today and list their time limits.",
      moodleUrl: "https://moodle.example/my/",
      autoAnswer: true,
    });

    expect(config.intentDecision).toMatchObject({
      intent: "quiz_assist",
      wantsQuizDiscovery: true,
    });
    expect(config.autoAnswer).toBe(false);
    expect(config.quizPolicy).toMatchObject({
      requestedAutoAnswer: false,
      allowAttemptOpen: false,
      allowAnswerFill: false,
      allowAnswerChange: false,
      allowSaveOrMovePage: false,
      allowFinalSubmit: false,
    });
  });

  it("keeps Study Builder extraction read-only while consuming the effective Quiz Assist mode", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-study-builder-quiz-config-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);
    vi.stubEnv("MOODLE_QUIZ_ACCESS_MODE", "quiz-assist");
    vi.stubEnv("MOODLE_QUIZ_AUTO_ANSWER", "true");
    vi.stubEnv("MOODLE_QUIZ_OPEN_ATTEMPTS", "true");
    vi.stubEnv("MOODLE_QUIZ_ALLOW_PAGE_SAVE_OR_MOVE", "true");

    const config = createRuntimeConfig({
      prompt: "Create an interactive Study Guide",
      moodleUrl: "https://moodle.example/course/view.php?id=42",
      evidenceHandoffOnly: true,
      stage: "extract",
    });

    expect(config.quizSafetyPolicy.accessMode).toBe("quiz-assist");
    expect(config.quizSafetyPolicy.allowReadingQuestions).toBe(true);
    expect(config.quizPolicy).toMatchObject({
      requestedAutoAnswer: false,
      allowAttemptOpen: false,
      allowAnswerFill: false,
      allowAnswerChange: false,
      allowSaveOrMovePage: false,
      allowFinalSubmit: false,
    });
  });

  it("uses a direct Moodle URL from the prompt when the configured URL is the dashboard", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-prompt-url-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);
    vi.stubEnv("MOODLE_DASHBOARD_URL", "");

    const config = createRuntimeConfig({
      prompt: "bearbeite das Moodle Quiz https://moodle.technikum-wien.at/mod/quiz/view.php?id=201",
      moodleUrl: "https://moodle.technikum-wien.at/my/",
    });

    expect(config.moodleUrl).toBe("https://moodle.technikum-wien.at/mod/quiz/view.php?id=201");
    expect(config.dashboardUrl).toBe("https://moodle.technikum-wien.at/my/");
  });

  it("keeps explicit configured activity URLs ahead of URLs mentioned in the prompt", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-explicit-url-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);

    const config = createRuntimeConfig({
      prompt: "vergleiche mit https://moodle.example.edu/mod/quiz/view.php?id=201",
      moodleUrl: "https://moodle.example.edu/course/view.php?id=101",
    });

    expect(config.moodleUrl).toBe("https://moodle.example.edu/course/view.php?id=101");
  });

  it("constrains direct quiz attempt pages to a single-page crawl by default", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "moodle-attempt-url-"));
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", tempRoot);

    const config = createRuntimeConfig({
      prompt: "bearbeite diese Seite https://moodle.example.edu/mod/quiz/attempt.php?attempt=301&cmid=201&page=8",
      moodleUrl: "https://moodle.example.edu/my/",
    });

    expect(config.moodleUrl).toBe(
      "https://moodle.example.edu/mod/quiz/attempt.php?attempt=301&cmid=201&page=8",
    );
    expect(config.maxDepth).toBe(0);
    expect(config.maxPages).toBe(1);
  });
});
