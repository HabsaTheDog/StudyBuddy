import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  dependencyRemediation,
  inspectSystemDependencies,
} from "../systemDependencies.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("system dependency diagnostics", () => {
  it.runIf(process.platform !== "win32")(
    "records resolved paths and versions without treating optional tools as fatal",
    async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "Study Buddy diagnostics ä "));
    directories.push(directory);
    const pdftotext = path.join(directory, "pdftotext");
    await writeFile(pdftotext, "#!/bin/sh\necho 'pdftotext fixture 1.2.3' >&2\n", { mode: 0o755 });

    const report = await inspectSystemDependencies({
      PATH: directory,
      STUDY_BUDDY_PDFTOTEXT_PATH: pdftotext,
    }, process.platform, process.arch);

    expect(report.packageManagement).toBe("system");
    expect(report.dependencies.node).toMatchObject({
      available: true,
      path: process.execPath,
      version: process.version,
    });
    expect(report.dependencies.playwright.available).toBe(true);
    expect(report.dependencies.pdftotext).toMatchObject({
      available: true,
      path: pdftotext,
      version: "pdftotext fixture 1.2.3",
    });
    expect(report.dependencies.pdftoppm).toMatchObject({ available: false, path: null, version: null });
    },
  );

  it("provides commands appropriate to Linux, macOS, and Windows", () => {
    expect(dependencyRemediation("pdftotext", "linux")[0]).toContain("apt-get");
    expect(dependencyRemediation("typst", "darwin")).toEqual(["brew install typst"]);
    expect(dependencyRemediation("libreoffice", "win32")[0]).toContain("winget");
  });
});
