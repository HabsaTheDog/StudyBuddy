import { statSync } from "node:fs";
import path from "node:path";

export interface BrowserExecutableLaunchOptions {
  executablePath?: string;
}

export function browserExecutableLaunchOptions(
  environment: NodeJS.ProcessEnv = process.env,
): BrowserExecutableLaunchOptions {
  const configured = environment.PLAYWRIGHT_EXECUTABLE_PATH?.trim();
  if (!configured) return {};
  if (!path.isAbsolute(configured)) {
    throw new Error("PLAYWRIGHT_EXECUTABLE_PATH must be an absolute file path.");
  }
  try {
    if (!statSync(configured).isFile()) throw new Error("not a file");
  } catch {
    throw new Error("The configured system browser executable is unavailable.");
  }
  return { executablePath: configured };
}
