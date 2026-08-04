import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunDiagnostics } from "../runDiagnostics.js";

const tempDirs: string[] = [];

afterEach(async () => {
  delete process.env.STUDY_BUDDY_DIAGNOSTICS_INCLUDE_SCREENSHOTS;
  delete process.env.STUDY_BUDDY_DIAGNOSTICS_INCLUDE_PAGE_CONTENT;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("run diagnostic privacy", () => {
  it("does not capture authenticated page contents or screenshots by default", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "diagnostic-security-"));
    tempDirs.push(runDir);
    const screenshot = vi.fn(async () => Buffer.from("image"));
    const innerText = vi.fn(async () => "Visible password-secret and session-secret");
    const content = vi.fn(async () =>
      '<html><input value="password-secret"><textarea>session-secret</textarea><script>const token="abc"</script></html>'
    );
    const page = {
      url: () => "https://moodle.example/course?sesskey=session-secret&token=abc",
      locator: () => ({ innerText }),
      content,
      screenshot,
    } as unknown as Page;
    const diagnostics = new RunDiagnostics({
      runDir,
      secrets: ["password-secret", "session-secret"],
    });
    await diagnostics.init();

    const artifacts = await diagnostics.capturePageDiagnostics("moodle", page, "failure", new Error("token=abc"));
    const combined = (
      await Promise.all(artifacts.map((filePath) => readFile(filePath, "utf8")))
    ).join("\n");

    expect(combined).not.toContain("password-secret");
    expect(combined).not.toContain("session-secret");
    expect(combined).not.toContain("const token");
    expect(combined).toContain("[redacted]");
    expect(innerText).not.toHaveBeenCalled();
    expect(content).not.toHaveBeenCalled();
    expect(screenshot).not.toHaveBeenCalled();
    expect(artifacts.some((filePath) => filePath.endsWith(".png"))).toBe(false);
  });

  it("sanitizes page contents when diagnostic content capture is explicitly enabled", async () => {
    process.env.STUDY_BUDDY_DIAGNOSTICS_INCLUDE_PAGE_CONTENT = "true";
    const runDir = await mkdtemp(path.join(os.tmpdir(), "diagnostic-content-"));
    tempDirs.push(runDir);
    const page = {
      url: () => "https://moodle.example/course?token=abc",
      locator: () => ({ innerText: async () => "Visible password-secret" }),
      content: async () =>
        '<html><input value="password-secret"><textarea>private notes</textarea><script>const token="abc"</script></html>',
      screenshot: vi.fn(),
    } as unknown as Page;
    const diagnostics = new RunDiagnostics({ runDir, secrets: ["password-secret"] });
    await diagnostics.init();

    const artifacts = await diagnostics.capturePageDiagnostics("moodle", page, "failure", new Error("failure"));
    const combined = (
      await Promise.all(artifacts.map((filePath) => readFile(filePath, "utf8")))
    ).join("\n");

    expect(combined).not.toContain("password-secret");
    expect(combined).not.toContain("private notes");
    expect(combined).not.toContain("const token");
    expect(combined).toContain("[redacted]");
  });

  it("serializes concurrent coverage persistence into valid final JSON", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "diagnostic-concurrency-"));
    tempDirs.push(runDir);
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();

    await Promise.all([
      diagnostics.markSuccess("moodle", { detail: "moodle ok", urls: ["https://moodle.example"], pages: 2 }),
      diagnostics.markSuccess("cis", { detail: "cis ok", urls: ["https://cis.example"], pages: 1 }),
      diagnostics.markSuccess("calendar", { detail: "calendar ok", urls: [], pages: 1 }),
    ]);

    const coverage = JSON.parse(await readFile(path.join(runDir, "source_coverage.json"), "utf8"));
    expect(coverage).toMatchObject({
      moodle: { status: "success" },
      cis: { status: "success" },
      calendar: { status: "success" },
    });
  });

  it("redacts secrets and credential-like query values from run-summary prompts", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "diagnostic-summary-"));
    tempDirs.push(runDir);
    const diagnostics = new RunDiagnostics({ runDir, secrets: ["calendar-secret"] });
    await diagnostics.init();

    await diagnostics.writeSummary({
      route: "quick_answer",
      status: "success",
      prompt: "Open https://moodle.example/course?token=url-secret and calendar-secret",
      taskPrompt: "Use https://cis.example/?access_token=task-secret",
      stateHasRawText: false,
      stateHasDocument: false,
    });

    const summary = await readFile(path.join(runDir, "run-summary.md"), "utf8");
    expect(summary).not.toContain("url-secret");
    expect(summary).not.toContain("task-secret");
    expect(summary).not.toContain("calendar-secret");
    expect(summary).toContain("[redacted]");
  });
});
