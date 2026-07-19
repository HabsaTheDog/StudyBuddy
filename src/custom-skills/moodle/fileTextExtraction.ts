import { access, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { runBoundedProcess } from "../shared/boundedProcess.js";

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

export type ExtractionExecutableName = "pdftotext" | "pdftoppm" | "libreoffice" | "typst";

const EXECUTABLE_OVERRIDES: Record<ExtractionExecutableName, string> = {
  pdftotext: "STUDY_BUDDY_PDFTOTEXT_PATH",
  pdftoppm: "STUDY_BUDDY_PDFTOPPM_PATH",
  libreoffice: "STUDY_BUDDY_LIBREOFFICE_PATH",
  typst: "STUDY_BUDDY_TYPST_PATH",
};

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
  const textPath = pdfPath.replace(/\.pdf$/i, ".extracted.txt");
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
  const conversionDir = await mkdtemp(path.join(path.dirname(filePath), ".office-conversion-"));
  try {
    const result = await runCommand(libreoffice, [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      conversionDir,
      filePath,
    ], options);
    if (result.code !== 0) {
      return extractionResult(filePath, "none", "", [
        result.stderr || result.stdout || `libreoffice exited with code ${result.code}`,
      ]);
    }
    const pdfPath = path.join(conversionDir, `${path.basename(filePath, path.extname(filePath))}.pdf`);
    const extracted = await extractPdfText(pdfPath, options);
    return { ...extracted, filePath, method: extracted.method === "none" ? "none" : "office_to_pdf" };
  } finally {
    await rm(conversionDir, { recursive: true, force: true });
  }
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

export async function resolveExtractionExecutable(
  name: ExtractionExecutableName,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
): Promise<string | null> {
  const overrideKey = EXECUTABLE_OVERRIDES[name];
  const override = environment[overrideKey]?.trim();
  if (override) {
    const resolved = path.resolve(override.replace(/^"|"$/g, ""));
    try {
      await access(resolved, platform === "win32" ? constants.F_OK : constants.X_OK);
      return resolved;
    } catch (error) {
      throw new Error(`${overrideKey} does not point to an executable file: ${resolved}`, { cause: error });
    }
  }
  const extensions = platform === "win32"
    ? (environment.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  const executableNames = name === "libreoffice" ? ["libreoffice", "soffice"] : [name];
  const commonDirectories = name === "libreoffice"
    ? platform === "win32"
      ? [environment.ProgramFiles, environment["ProgramFiles(x86)"]]
          .filter((entry): entry is string => Boolean(entry))
          .map((entry) => path.join(entry, "LibreOffice", "program"))
      : platform === "darwin"
        ? ["/Applications/LibreOffice.app/Contents/MacOS"]
        : []
    : [];
  for (const entry of [...executableSearchDirectories(environment, platform, architecture), ...commonDirectories]) {
    for (const extension of extensions) {
      for (const executableName of executableNames) {
        const candidate = path.join(entry, platform === "win32" ? `${executableName}${extension.toLowerCase()}` : executableName);
        try {
          await access(candidate, platform === "win32" ? constants.F_OK : constants.X_OK);
          return candidate;
        } catch {
          // Keep looking.
        }
      }
    }
  }
  return null;
}

export function executableSearchDirectories(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
): string[] {
  const pathDelimiter = platform === "win32" ? ";" : path.delimiter;
  const configured = (environment.PATH || "")
    .split(pathDelimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  const homebrew = platform === "darwin"
    ? architecture === "arm64"
      ? ["/opt/homebrew/bin", "/usr/local/bin"]
      : ["/usr/local/bin", "/opt/homebrew/bin"]
    : [];
  return [...new Set([...configured, ...homebrew])];
}

async function findExecutable(name: keyof typeof EXECUTABLE_OVERRIDES): Promise<string | null> {
  return resolveExtractionExecutable(name);
}

function runCommand(
  command: string,
  args: string[],
  options: { signal?: AbortSignal; commandTimeoutMs?: number } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return runBoundedProcess(command, args, {
    signal: options.signal,
    timeoutMs: options.commandTimeoutMs,
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
