import { access, open, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export type FileExtractionMethod = "plain_text" | "native_pdf_text" | "office_to_pdf" | "none";

export interface FileExtractionResult {
  filePath: string;
  status: "usable" | "partial" | "unusable";
  method: FileExtractionMethod;
  text: string;
  characterCount: number;
  pageCount: number | null;
  warnings: string[];
}

export interface ExtractionTooling {
  pdftotext: boolean;
  pdftoppm: boolean;
  libreoffice: boolean;
}

export async function extractReadableFile(
  filePath: string,
  options: { signal?: AbortSignal; commandTimeoutMs?: number } = {},
): Promise<FileExtractionResult> {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    const text = await readFile(filePath, "utf8");
    return extractionResult(filePath, "plain_text", text, []);
  }
  if (lower.endsWith(".pdf")) {
    return extractPdfText(filePath, options);
  }
  if (/\.(?:docx?|pptx?|xlsx?)$/i.test(lower)) {
    return extractOfficeText(filePath, options);
  }
  return extractionResult(filePath, "none", "", ["Unsupported file type for text extraction."]);
}

export async function extractReadableFileText(filePath: string): Promise<string> {
  const result = await extractReadableFile(filePath);
  if (result.status === "unusable") {
    throw new Error(result.warnings.join(" ") || "File contains no usable readable text.");
  }
  return result.text;
}

export async function assertReadableDownloadedFile(filePath: string): Promise<void> {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".pdf")) {
    await assertPdfFile(filePath);
  }
}

async function assertPdfFile(filePath: string): Promise<void> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, bytesRead);
    const pdfOffset = sample.indexOf(Buffer.from("%PDF-"));
    if (pdfOffset >= 0 && pdfOffset <= 1024) {
      return;
    }
    const textSample = sample.toString("utf8").replace(/\s+/g, " ").trim().slice(0, 180);
    const looksLikeHtml = /^\s*<!doctype html|^\s*<html[\s>]/i.test(sample.toString("utf8"));
    throw new Error(
      looksLikeHtml
        ? `Downloaded file is not a PDF; Moodle returned an HTML page instead (${textSample}).`
        : `Downloaded file is not a PDF; missing PDF header (${textSample || "binary content"}).`,
    );
  } finally {
    await handle.close();
  }
}

export async function extractPdfText(
  pdfPath: string,
  options: { signal?: AbortSignal; commandTimeoutMs?: number } = {},
): Promise<FileExtractionResult> {
  const pdftotext = await findExecutable("pdftotext");
  if (!pdftotext) {
    return extractionResult(pdfPath, "none", "", ["pdftotext executable was not found on PATH."]);
  }
  const textPath = pdfPath.replace(/\.pdf$/i, ".txt");
  const result = await runCommand(pdftotext, ["-layout", pdfPath, textPath], options);
  if (result.code !== 0) {
    return extractionResult(pdfPath, "none", "", [
      result.stderr || result.stdout || `pdftotext exited with code ${result.code}`,
    ]);
  }
  const text = await readFile(textPath, "utf8");
  await writeFile(textPath, text, "utf8");
  if (text.replace(/\s+/g, "").length >= 80) {
    return extractionResult(pdfPath, "native_pdf_text", text, []);
  }
  return extractionResult(pdfPath, "native_pdf_text", text, [
    "PDF contains little embedded text. Automatic OCR is intentionally disabled; the catalog can still expose this resource and the visual pipeline can inspect selected pages.",
  ]);
}

async function extractOfficeText(
  filePath: string,
  options: { signal?: AbortSignal; commandTimeoutMs?: number },
): Promise<FileExtractionResult> {
  const libreoffice = await findExecutable("libreoffice");
  if (!libreoffice) {
    return extractionResult(filePath, "none", "", ["libreoffice executable was not found on PATH."]);
  }
  const outputDir = path.dirname(filePath);
  const result = await runCommand(libreoffice, [
    "--headless",
    "--convert-to",
    "pdf",
    "--outdir",
    outputDir,
    filePath,
  ], options);
  if (result.code !== 0) {
    return extractionResult(filePath, "none", "", [
      result.stderr || result.stdout || `libreoffice exited with code ${result.code}`,
    ]);
  }
  const pdfPath = path.join(outputDir, `${path.basename(filePath, path.extname(filePath))}.pdf`);
  const extracted = await extractPdfText(pdfPath, options);
  return { ...extracted, filePath, method: extracted.method === "none" ? "none" : "office_to_pdf" };
}

export async function inspectExtractionTooling(): Promise<ExtractionTooling> {
  const [pdftotext, pdftoppm, libreoffice] = await Promise.all([
    findExecutable("pdftotext"),
    findExecutable("pdftoppm"),
    findExecutable("libreoffice"),
  ]);
  return {
    pdftotext: Boolean(pdftotext),
    pdftoppm: Boolean(pdftoppm),
    libreoffice: Boolean(libreoffice),
  };
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
  options: { signal?: AbortSignal; commandTimeoutMs?: number } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let settled = false;
    let killTimer: NodeJS.Timeout | null = null;
    let commandTimer: NodeJS.Timeout | null = null;
    let stdout = "";
    let stderr = "";
    const stop = (reason: Error) => {
      if (settled) return;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
      settled = true;
      reject(reason);
    };
    const abort = () => stop(options.signal?.reason instanceof Error
      ? options.signal.reason
      : new Error("File extraction canceled."));
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    const timeoutMs = options.commandTimeoutMs ?? 90_000;
    if (timeoutMs > 0) {
      commandTimer = setTimeout(() => stop(new Error(`${path.basename(command)} timed out after ${timeoutMs}ms.`)), timeoutMs);
    }
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (code) => {
      if (killTimer) clearTimeout(killTimer);
      if (commandTimer) clearTimeout(commandTimer);
      options.signal?.removeEventListener("abort", abort);
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr });
    });
  });
}

function extractionResult(
  filePath: string,
  method: FileExtractionMethod,
  text: string,
  warnings: string[],
  explicitPageCount?: number,
): FileExtractionResult {
  const characterCount = text.replace(/\s+/g, "").length;
  const status = characterCount >= 80
    ? "usable"
    : characterCount >= 24
      ? "partial"
      : "unusable";
  return {
    filePath,
    status,
    method,
    text,
    characterCount,
    pageCount: explicitPageCount ?? (text ? text.split("\f").length : null),
    warnings,
  };
}
