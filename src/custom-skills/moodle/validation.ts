import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { ExtractedDataSchema, type ExtractedData } from "./schemas.js";
import type { JsonArray, JsonObject, JsonValue } from "./state.js";

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

export async function validateTypst(source: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const typstPath = await findExecutable("typst");
  if (!typstPath) {
    return { ok: true };
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "moodle-typst-"));
  const sourcePath = path.join(tempDir, "document.typ");
  const targetPath = path.join(tempDir, "document.pdf");
  await writeFile(sourcePath, source, "utf8");

  try {
    const result = await runCommand(typstPath, ["compile", sourcePath, targetPath]);
    if (result.code === 0) {
      return { ok: true };
    }
    return { ok: false, error: result.stderr || result.stdout || `typst exited with code ${result.code}` };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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

async function findExecutable(name: string): Promise<string | null> {
  const pathEntries = (process.env.PATH || "").split(path.delimiter);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }
  return null;
}

function runCommand(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
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
