import { access, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
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
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(textPath, "utf8");
  await writeFile(textPath, text, "utf8");
  return text;
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
