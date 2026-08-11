import { describe, expect, it, vi } from "vitest";
import { launchMoodleBrowser } from "../browserLaunch.js";

describe("launchMoodleBrowser", () => {
  it("passes a bounded timeout to Playwright", async () => {
    const browser = { close: vi.fn() };
    const launcher = { launch: vi.fn().mockResolvedValue(browser) };

    await expect(launchMoodleBrowser({
      headless: true,
      timeoutMs: 1234,
      launcher: launcher as never,
      purpose: "course crawler",
    })).resolves.toBe(browser);

    expect(launcher.launch).toHaveBeenCalledWith({ headless: true, timeout: 1234 });
  });

  it("rejects a browser launch that never settles", async () => {
    const launcher = { launch: vi.fn(() => new Promise(() => undefined)) };

    await expect(launchMoodleBrowser({
      headless: true,
      timeoutMs: 20,
      launcher: launcher as never,
      purpose: "Moodle scraper",
    })).rejects.toThrow("Moodle scraper launch timed out after 20ms");
  });

  it("closes a browser that appears after the caller aborts", async () => {
    const controller = new AbortController();
    const browser = { close: vi.fn().mockResolvedValue(undefined) };
    let resolveLaunch!: (value: typeof browser) => void;
    const launcher = {
      launch: vi.fn(() => new Promise<typeof browser>((resolve) => {
        resolveLaunch = resolve;
      })),
    };
    const result = launchMoodleBrowser({
      headless: true,
      abortSignal: controller.signal,
      launcher: launcher as never,
    });

    controller.abort(new Error("run canceled"));
    await expect(result).rejects.toThrow("run canceled");
    resolveLaunch(browser);
    await Promise.resolve();
    await Promise.resolve();

    expect(browser.close).toHaveBeenCalledOnce();
  });
});
