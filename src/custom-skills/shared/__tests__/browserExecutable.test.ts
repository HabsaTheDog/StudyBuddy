import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { browserExecutableLaunchOptions } from "../browserExecutable.js";

const temporary = mkdtempSync(path.join(tmpdir(), "study-buddy-browser-"));
const executable = path.join(temporary, process.platform === "win32" ? "browser.exe" : "browser");
writeFileSync(executable, "browser fixture");

afterAll(() => rmSync(temporary, { recursive: true, force: true }));

describe("browserExecutableLaunchOptions", () => {
  it("uses Playwright's managed browser when no system browser is configured", () => {
    expect(browserExecutableLaunchOptions({})).toEqual({});
  });

  it("passes through an existing absolute system-browser executable", () => {
    expect(browserExecutableLaunchOptions({ PLAYWRIGHT_EXECUTABLE_PATH: executable })).toEqual({
      executablePath: executable,
    });
  });

  it("fails early for relative, missing, or directory paths", () => {
    expect(() =>
      browserExecutableLaunchOptions({ PLAYWRIGHT_EXECUTABLE_PATH: "browser" }),
    ).toThrow("absolute file path");
    expect(() =>
      browserExecutableLaunchOptions({ PLAYWRIGHT_EXECUTABLE_PATH: path.join(temporary, "missing") }),
    ).toThrow("system browser executable is unavailable");
    expect(() =>
      browserExecutableLaunchOptions({ PLAYWRIGHT_EXECUTABLE_PATH: temporary }),
    ).toThrow("system browser executable is unavailable");
  });
});
