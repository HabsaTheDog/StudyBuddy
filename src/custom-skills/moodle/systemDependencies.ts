import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runBoundedProcess } from "../shared/boundedProcess.js";
import {
  resolveExtractionExecutable,
  type ExtractionExecutableName,
} from "./fileTextExtraction.js";

export type SystemDependencyName =
  | "node"
  | "playwright"
  | ExtractionExecutableName;

export interface SystemDependencyDiagnostic {
  available: boolean;
  requiredFor: string;
  path: string | null;
  version: string | null;
  remediation: string[];
  error?: string;
}

export interface SystemDependencyReport {
  schemaVersion: 1;
  generatedAt: string;
  platform: NodeJS.Platform;
  architecture: string;
  packageManagement: "system";
  dependencies: Record<SystemDependencyName, SystemDependencyDiagnostic>;
}

const require = createRequire(import.meta.url);

const PURPOSES: Record<SystemDependencyName, string> = {
  node: "Study Buddy runtime (required)",
  playwright: "Authenticated browser automation (required)",
  typst: "PDF study-guide generation (required for PDF output)",
  pdftotext: "Native PDF text extraction (required for complete PDF coverage)",
  pdftoppm: "Selected PDF page rendering (required when visual handling is enabled)",
  libreoffice: "Office-document conversion (optional)",
};

const VERSION_ARGUMENTS: Record<ExtractionExecutableName, readonly string[]> = {
  pdftotext: ["-v"],
  pdftoppm: ["-v"],
  libreoffice: ["--version"],
  typst: ["--version"],
};

export async function inspectSystemDependencies(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
): Promise<SystemDependencyReport> {
  const executableNames: ExtractionExecutableName[] = [
    "typst",
    "pdftotext",
    "pdftoppm",
    "libreoffice",
  ];
  const executableEntries = await Promise.all(executableNames.map(async (name) => {
    const diagnostic = await inspectExecutable(name, environment, platform, architecture);
    return [name, diagnostic] as const;
  }));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    platform,
    architecture,
    packageManagement: "system",
    dependencies: {
      node: {
        available: true,
        requiredFor: PURPOSES.node,
        path: process.execPath,
        version: process.version,
        remediation: dependencyRemediation("node", platform),
      },
      playwright: await inspectPlaywright(platform),
      ...Object.fromEntries(executableEntries),
    } as Record<SystemDependencyName, SystemDependencyDiagnostic>,
  };
}

export function dependencyRemediation(
  name: SystemDependencyName,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === "win32") {
    const commands: Record<SystemDependencyName, string[]> = {
      node: ["winget install --id OpenJS.NodeJS.LTS --exact"],
      playwright: ["npm ci", "npx playwright install chromium"],
      typst: ["winget install --id Typst.Typst --exact"],
      pdftotext: [
        "scoop install poppler",
        "Or download a pinned release from https://github.com/oschwartz10612/poppler-windows/releases and add Library\\bin to PATH",
      ],
      pdftoppm: [
        "scoop install poppler",
        "Or download a pinned release from https://github.com/oschwartz10612/poppler-windows/releases and add Library\\bin to PATH",
      ],
      libreoffice: ["winget install --id TheDocumentFoundation.LibreOffice --exact"],
    };
    return commands[name];
  }
  if (platform === "darwin") {
    const commands: Record<SystemDependencyName, string[]> = {
      node: ["brew install node@22"],
      playwright: ["npm ci", "npx playwright install chromium"],
      typst: ["brew install typst"],
      pdftotext: ["brew install poppler"],
      pdftoppm: ["brew install poppler"],
      libreoffice: ["brew install --cask libreoffice"],
    };
    return commands[name];
  }
  const commands: Record<SystemDependencyName, string[]> = {
    node: ["Install Node.js 22 or newer: https://nodejs.org/en/download"],
    playwright: ["npm ci", "npx playwright install --with-deps chromium"],
    typst: ["sudo snap install typst", "Or install from https://github.com/typst/typst/releases"],
    pdftotext: ["Debian/Ubuntu: sudo apt-get install poppler-utils", "Fedora: sudo dnf install poppler-utils"],
    pdftoppm: ["Debian/Ubuntu: sudo apt-get install poppler-utils", "Fedora: sudo dnf install poppler-utils"],
    libreoffice: ["Debian/Ubuntu: sudo apt-get install libreoffice", "Fedora: sudo dnf install libreoffice"],
  };
  return commands[name];
}

async function inspectExecutable(
  name: ExtractionExecutableName,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  architecture: string,
): Promise<SystemDependencyDiagnostic> {
  const remediation = dependencyRemediation(name, platform);
  try {
    const executablePath = await resolveExtractionExecutable(name, environment, platform, architecture);
    if (!executablePath) {
      return {
        available: false,
        requiredFor: PURPOSES[name],
        path: null,
        version: null,
        remediation,
      };
    }
    const result = await runBoundedProcess(executablePath, VERSION_ARGUMENTS[name], {
      env: environment,
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024,
    });
    const version = firstNonEmptyLine(result.stdout, result.stderr);
    return {
      available: result.code === 0,
      requiredFor: PURPOSES[name],
      path: executablePath,
      version,
      remediation,
      ...(result.code === 0 ? {} : { error: `${name} exited with code ${String(result.code)} while reading its version.` }),
    };
  } catch (error) {
    return {
      available: false,
      requiredFor: PURPOSES[name],
      path: null,
      version: null,
      remediation,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function inspectPlaywright(platform: NodeJS.Platform): Promise<SystemDependencyDiagnostic> {
  const remediation = dependencyRemediation("playwright", platform);
  try {
    const packagePath = require.resolve("playwright/package.json");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as { version?: unknown };
    return {
      available: true,
      requiredFor: PURPOSES.playwright,
      path: packagePath,
      version: typeof packageJson.version === "string" ? packageJson.version : null,
      remediation,
    };
  } catch (error) {
    return {
      available: false,
      requiredFor: PURPOSES.playwright,
      path: null,
      version: null,
      remediation,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function firstNonEmptyLine(...values: string[]): string | null {
  for (const value of values) {
    const line = value.split(/\r?\n/).map((entry) => entry.trim()).find(Boolean);
    if (line) return line;
  }
  return null;
}
