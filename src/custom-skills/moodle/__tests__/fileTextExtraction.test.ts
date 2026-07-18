import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractReadableFile, resolveExtractionExecutable } from "../fileTextExtraction.js";
import { recordExtractionResult } from "../extractionReport.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("structured file extraction", () => {
  it("reports method, usability, size, and page count for plain text", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "study-buddy-extraction-"));
    directories.push(directory);
    const filePath = path.join(directory, "source.txt");
    await writeFile(filePath, "A sufficiently detailed source paragraph about dynamics and angular momentum.");

    const result = await extractReadableFile(filePath);

    expect(result.status).toBe("partial");
    expect(result.method).toBe("plain_text");
    expect(result.characterCount).toBeGreaterThan(24);
    expect(result.pageCount).toBe(1);
  });

  it("reports unsupported files without throwing away diagnostics", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "study-buddy-extraction-"));
    directories.push(directory);
    const filePath = path.join(directory, "source.bin");
    await writeFile(filePath, "binary fixture");

    const result = await extractReadableFile(filePath);

    expect(result.status).toBe("unusable");
    expect(result.method).toBe("none");
    expect(result.warnings[0]).toContain("Unsupported file type");
  });

  it("keeps the extraction audit compact instead of duplicating full source text", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "study-buddy-extraction-"));
    directories.push(directory);
    const filePath = path.join(directory, "source.txt");
    await writeFile(filePath, "A long source body that belongs in the source artifact, not in diagnostics.".repeat(20));
    const result = await extractReadableFile(filePath);

    await recordExtractionResult(directory, result);

    const report = JSON.parse(await readFile(path.join(directory, "extraction-report.json"), "utf8"));
    expect(report.resources[0]).not.toHaveProperty("text");
    expect(report.resources[0]).toMatchObject({
      filePath,
      method: "plain_text",
      status: "usable",
      characterCount: result.characterCount,
    });
  });

  it("honors explicit executable overrides and Windows PATHEXT discovery", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "study-buddy-executables-"));
    directories.push(directory);
    const overridePath = path.join(directory, "PDF Tools", "pdftotext custom");
    await mkdir(path.dirname(overridePath), { recursive: true });
    await writeFile(overridePath, "fixture", { mode: 0o755 });

    await expect(resolveExtractionExecutable("pdftotext", {
      STUDY_BUDDY_PDFTOTEXT_PATH: overridePath,
    })).resolves.toBe(overridePath);

    const windowsExecutable = path.join(directory, "pdftoppm.exe");
    await writeFile(windowsExecutable, "fixture");
    await expect(resolveExtractionExecutable("pdftoppm", {
      PATH: directory,
      PATHEXT: ".EXE;.CMD",
    }, "win32")).resolves.toBe(windowsExecutable);
  });

  it("reports an invalid executable override instead of silently falling back", async () => {
    await expect(resolveExtractionExecutable("libreoffice", {
      STUDY_BUDDY_LIBREOFFICE_PATH: "/definitely/missing/libreoffice",
    })).rejects.toThrow("STUDY_BUDDY_LIBREOFFICE_PATH");
  });
});
