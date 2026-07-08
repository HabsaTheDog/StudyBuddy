import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export async function extractReadableFileText(filePath: string): Promise<string> {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    const { readFile } = await import("node:fs/promises");
    return readFile(filePath, "utf8");
  }
  if (lower.endsWith(".pdf")) {
    return extractPdfText(filePath);
  }
  if (/\.(?:docx?|pptx?|xlsx?)$/i.test(lower)) {
    return extractOfficeText(filePath);
  }
  return "";
}

export async function extractPdfText(pdfPath: string): Promise<string> {
  const pdftotext = await findExecutable("pdftotext");
  if (!pdftotext) {
    throw new Error("pdftotext executable was not found on PATH.");
  }
  const textPath = pdfPath.replace(/\.pdf$/i, ".txt");
  const result = await runCommand(pdftotext, ["-layout", pdfPath, textPath]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `pdftotext exited with code ${result.code}`);
  }
  const text = await readFile(textPath, "utf8");
  await writeFile(textPath, text, "utf8");
  if (text.replace(/\s+/g, "").length >= 80) {
    return text;
  }
  return extractPdfOcr(pdfPath, text);
}

async function extractOfficeText(filePath: string): Promise<string> {
  const libreoffice = await findExecutable("libreoffice");
  if (!libreoffice) {
    throw new Error("libreoffice executable was not found on PATH.");
  }
  const outputDir = path.dirname(filePath);
  const result = await runCommand(libreoffice, [
    "--headless",
    "--convert-to",
    "pdf",
    "--outdir",
    outputDir,
    filePath,
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `libreoffice exited with code ${result.code}`);
  }
  const pdfPath = path.join(outputDir, `${path.basename(filePath, path.extname(filePath))}.pdf`);
  return extractPdfText(pdfPath);
}

async function extractPdfOcr(pdfPath: string, sparseText: string): Promise<string> {
  const [pdftoppm, tesseract] = await Promise.all([
    findExecutable("pdftoppm"),
    findExecutable("tesseract"),
  ]);
  if (!pdftoppm || !tesseract) {
    throw new Error(
      "PDF contains too little readable text and OCR is unavailable. Install pdftoppm and tesseract.",
    );
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-ocr-"));
  try {
    const prefix = path.join(tempDir, "page");
    const render = await runCommand(pdftoppm, ["-png", "-r", "180", pdfPath, prefix]);
    if (render.code !== 0) {
      throw new Error(render.stderr || render.stdout || "pdftoppm OCR render failed.");
    }
    const images = (await readdir(tempDir))
      .filter((fileName) => /^page-\d+\.png$/i.test(fileName))
      .sort();
    const pages: string[] = [];
    for (const image of images) {
      const outputBase = path.join(tempDir, path.basename(image, ".png"));
      const ocr = await runCommand(tesseract, [
        path.join(tempDir, image),
        outputBase,
        "-l",
        process.env.STUDY_BUDDY_OCR_LANG || "deu+eng",
      ]);
      if (ocr.code !== 0) {
        throw new Error(ocr.stderr || ocr.stdout || `tesseract failed for ${image}`);
      }
      pages.push(await readFile(`${outputBase}.txt`, "utf8"));
    }
    const text = [sparseText, ...pages].filter((value) => value.trim()).join("\n\n");
    await writeFile(pdfPath.replace(/\.pdf$/i, ".ocr.txt"), text, "utf8");
    return text;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function findExecutable(name: string): Promise<string | null> {
  for (const entry of (process.env.PATH || "").split(path.delimiter)) {
    const candidate = path.join(entry, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep looking.
    }
  }
  return null;
}

function runCommand(
  command: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
