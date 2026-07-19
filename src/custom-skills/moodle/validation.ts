import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ExtractedDataSchema, type ExtractedData } from "./schemas.js";
import type { JsonArray, JsonObject, JsonValue } from "./state.js";
import { runBoundedProcess } from "../shared/boundedProcess.js";
import { resolveExtractionExecutable } from "./fileTextExtraction.js";

export function parseJsonObjectOrArray(text: string): JsonObject | JsonArray {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const jsonText = fenced?.[1] ?? trimmed;
  const parsed = JSON.parse(jsonText) as JsonValue;
  if (!parsed || (typeof parsed !== "object" && !Array.isArray(parsed))) {
    throw new Error("Expected a JSON object or array.");
  }
  return parsed as JsonObject | JsonArray;
}

export function validateExtractedData(value: unknown): ExtractedData {
  return ExtractedDataSchema.parse(value);
}

export async function validateTypst(
  source: string,
  supportFiles: TypstSupportFile[] = [],
  options: { assetBaseDir?: string; preview?: boolean; signal?: AbortSignal; commandTimeoutMs?: number } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const typstPath = await findExecutable("typst");
  if (!typstPath) {
    return { ok: false, error: "typst executable was not found on PATH." };
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "moodle-typst-"));
  const sourcePath = path.join(tempDir, "document.typ");
  const targetPath = path.join(tempDir, "document.pdf");
  await writeFile(sourcePath, source, "utf8");
  await writeTypstSupportFiles(tempDir, supportFiles);
  if (options.assetBaseDir) {
    await copyReferencedVisualAssets(source, options.assetBaseDir, tempDir);
  }

  try {
    const packagePath = inferPackagePath(tempDir, supportFiles);
    const result = await runTypstCompile(typstPath, sourcePath, targetPath, {
      packagePath,
      signal: options.signal,
      commandTimeoutMs: options.commandTimeoutMs,
    });
    if (result.code !== 0) {
      return { ok: false, error: result.stderr || result.stdout || `typst exited with code ${result.code}` };
    }
    if (/warning:/i.test(result.stderr)) {
      return { ok: false, error: `Typst emitted a warning:\n${result.stderr}` };
    }

    if (options.preview !== false) {
      const previewPattern = path.join(tempDir, "preview-{0p}.png");
      const renderResult = await runTypstCompile(typstPath, sourcePath, previewPattern, {
        packagePath,
        format: "png",
        ppi: 144,
        signal: options.signal,
        commandTimeoutMs: options.commandTimeoutMs,
      });
      if (renderResult.code !== 0) {
        return {
          ok: false,
          error: `Typst preview render failed:\n${renderResult.stderr || renderResult.stdout}`,
        };
      }
      const previews = (await readdir(tempDir))
        .filter((fileName) => /^preview-\d+\.png$/.test(fileName));
      if (previews.length === 0) {
        return { ok: false, error: "Typst preview render produced no pages." };
      }
      for (const preview of previews) {
        const previewStat = await stat(path.join(tempDir, preview));
        if (previewStat.size === 0) {
          return { ok: false, error: `Typst preview page is empty: ${preview}` };
        }
      }
    }
    return { ok: true };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export interface TypstSupportFile {
  relativePath: string;
  content: string | Uint8Array;
}

export type TypstCompileResult =
  | { ok: true; skipped: false }
  | { ok: false; error: string };

export interface TypstCompileOptions {
  packagePath?: string;
  signal?: AbortSignal;
  commandTimeoutMs?: number;
}

export async function compileTypstPdf(
  sourcePath: string,
  targetPath: string,
  options: TypstCompileOptions = {},
): Promise<TypstCompileResult> {
  const typstPath = await findExecutable("typst");
  if (!typstPath) {
    return { ok: false, error: "typst executable was not found on PATH; PDF generation is required." };
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  const result = await runTypstCompile(typstPath, sourcePath, targetPath, options);
  if (result.code === 0) {
    const targetStat = await stat(targetPath).catch(() => null);
    if (targetStat?.isFile() && targetStat.size > 0) {
      return { ok: true, skipped: false };
    }
    return { ok: false, error: "Typst exited successfully but produced no readable PDF file." };
  }
  return {
    ok: false,
    error: result.stderr || result.stdout || `typst exited with code ${result.code}`,
  };
}

export function ensureInside(baseDir: string, targetPath: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedBase, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside run directory: ${resolvedTarget}`);
  }
  return resolvedTarget;
}

export async function writeTypstSupportFiles(
  baseDir: string,
  supportFiles: TypstSupportFile[],
): Promise<void> {
  for (const file of supportFiles) {
    const supportPath = ensureInside(baseDir, path.join(baseDir, file.relativePath));
    await mkdir(path.dirname(supportPath), { recursive: true });
    await writeFile(supportPath, file.content, "utf8");
  }
}

async function copyReferencedVisualAssets(
  source: string,
  assetBaseDir: string,
  tempDir: string,
): Promise<void> {
  const paths = [...source.matchAll(/#image\s*\(\s*"([^"]+)"/g)].map((match) => match[1]);
  for (const relativePath of new Set(paths)) {
    if (!relativePath.startsWith("assets/visuals/")) {
      continue;
    }
    const sourcePath = ensureInside(assetBaseDir, path.join(assetBaseDir, relativePath));
    const targetPath = ensureInside(tempDir, path.join(tempDir, relativePath));
    const sourceStat = await stat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile()) {
      throw new Error(`Referenced visual asset is missing: ${relativePath}`);
    }
    await mkdir(path.dirname(targetPath), { recursive: true });
    const { copyFile } = await import("node:fs/promises");
    await copyFile(sourcePath, targetPath);
  }
}

function inferPackagePath(baseDir: string, supportFiles: TypstSupportFile[]): string | undefined {
  const packageRoot = supportFiles
    .map((file) => file.relativePath.split(/[\\/]/)[0])
    .find((segment) => segment === ".typst-packages");
  return packageRoot ? path.join(baseDir, packageRoot) : undefined;
}

interface TypstRenderOptions extends TypstCompileOptions {
  format?: "pdf" | "png";
  ppi?: number;
}

function runTypstCompile(
  typstPath: string,
  sourcePath: string,
  targetPath: string,
  options: TypstRenderOptions,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const args = ["compile"];
  if (options.packagePath) {
    args.push("--package-path", options.packagePath);
  }
  if (options.format) {
    args.push("--format", options.format);
  }
  if (options.ppi) {
    args.push("--ppi", String(options.ppi));
  }
  args.push(sourcePath, targetPath);
  return runBoundedProcess(typstPath, args, {
    signal: options.signal,
    timeoutMs: options.commandTimeoutMs,
  });
}

async function findExecutable(name: string): Promise<string | null> {
  if (name !== "typst") return null;
  return resolveExtractionExecutable("typst");
}
