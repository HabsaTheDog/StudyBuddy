import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  executableSearchDirectories,
  extractReadableFile,
  resolveExtractionExecutable,
} from "../fileTextExtraction.js";
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

  it("finds LibreOffice's native soffice executable outside PATH on Windows", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "Study Buddy Program Files "));
    directories.push(directory);
    const sofficePath = path.join(directory, "LibreOffice", "program", "soffice.exe");
    await mkdir(path.dirname(sofficePath), { recursive: true });
    await writeFile(sofficePath, "fixture");

    await expect(resolveExtractionExecutable("libreoffice", {
      PATH: "",
      PATHEXT: ".EXE",
      ProgramFiles: directory,
    }, "win32")).resolves.toBe(sofficePath);
  });

  it("checks both Apple Silicon and Intel Homebrew locations", () => {
    expect(executableSearchDirectories({ PATH: "/custom/bin" }, "darwin", "arm64"))
      .toEqual(["/custom/bin", "/opt/homebrew/bin", "/usr/local/bin"]);
    expect(executableSearchDirectories({ PATH: "/custom/bin" }, "darwin", "x64"))
      .toEqual(["/custom/bin", "/usr/local/bin", "/opt/homebrew/bin"]);
  });

  it(
    "extracts a text PDF from a path containing spaces and non-ASCII characters",
    async () => {
      const pdftotext = await resolveExtractionExecutable("pdftotext");
      expect(pdftotext, "pdftotext must be installed for the PDF smoke test").not.toBeNull();
      const directory = await mkdtemp(path.join(os.tmpdir(), "Study Buddy Prüfpfad "));
      directories.push(directory);
      const filePath = path.join(directory, "lecture notes ä.pdf");
      await writeFile(filePath, createPdf(
        "Angular momentum and rotational dynamics are related through torque, inertia, and angular velocity in this complete source paragraph.",
      ));

      const result = await extractReadableFile(filePath);

      expect(result.status).toBe("usable");
      expect(result.method).toBe("native_pdf_text");
      expect(result.text).toContain("Angular momentum");
    },
  );

  it(
    "returns a bounded partial result for a PDF without embedded text",
    async () => {
      const pdftotext = await resolveExtractionExecutable("pdftotext");
      expect(pdftotext, "pdftotext must be installed for the PDF smoke test").not.toBeNull();
      const directory = await mkdtemp(path.join(os.tmpdir(), "study-buddy-scanned-pdf-"));
      directories.push(directory);
      const filePath = path.join(directory, "scanned.pdf");
      await writeFile(filePath, createPdf(""));

      const result = await extractReadableFile(filePath);

      expect(result.status).toBe("unusable");
      expect(result.method).toBe("native_pdf_text");
      expect(result.warnings.join(" ")).toContain("Automatic OCR is intentionally disabled");
    },
  );
});

function createPdf(text: string): Buffer {
  const escapedText = text.replace(/([\\()])/g, "\\$1");
  const stream = text ? `BT /F1 12 Tf 72 720 Td (${escapedText}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(body);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "utf8");
}
