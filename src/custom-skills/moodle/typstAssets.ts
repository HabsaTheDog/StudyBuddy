import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TypstSupportFile } from "./validation.js";
import {
  STUDY_BUDDY_COMPONENTS_FILE,
  STUDY_BUDDY_PACKAGE_DIR,
  STUDY_BUDDY_TEMPLATE_COMPATIBILITY,
  STUDY_BUDDY_TEMPLATE_FILE,
} from "./typstTemplate.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const TYPST_ASSET_DIR = path.join(MODULE_DIR, "typst");
const COMPONENT_LIBRARY_PATH = path.join(TYPST_ASSET_DIR, STUDY_BUDDY_COMPONENTS_FILE);
const VENDORED_PACKAGE_PATH = path.join(TYPST_ASSET_DIR, "vendor");
const STUDY_BUDDY_LOGO_PATH = path.resolve(MODULE_DIR, "../../../CI/logo.png");
const STUDY_BUDDY_LOGO_FILE = "assets/study-buddy-logo.png";

let supportFilesPromise: Promise<TypstSupportFile[]> | null = null;

export function getStudyBuddyTypstSupportFiles(): Promise<TypstSupportFile[]> {
  supportFilesPromise ??= loadStudyBuddyTypstSupportFiles();
  return supportFilesPromise;
}

export function studyBuddyTypstPackagePath(baseDir: string): string {
  return path.join(baseDir, STUDY_BUDDY_PACKAGE_DIR);
}

async function loadStudyBuddyTypstSupportFiles(): Promise<TypstSupportFile[]> {
  const componentLibrary = await readFile(COMPONENT_LIBRARY_PATH);
  const studyBuddyLogo = await readFile(STUDY_BUDDY_LOGO_PATH);
  const vendoredPackages = await readDirectoryFiles(
    VENDORED_PACKAGE_PATH,
    STUDY_BUDDY_PACKAGE_DIR,
  );
  return [
    {
      relativePath: STUDY_BUDDY_COMPONENTS_FILE,
      content: componentLibrary,
    },
    {
      relativePath: STUDY_BUDDY_TEMPLATE_FILE,
      content: STUDY_BUDDY_TEMPLATE_COMPATIBILITY,
    },
    {
      relativePath: STUDY_BUDDY_LOGO_FILE,
      content: studyBuddyLogo,
    },
    ...vendoredPackages,
  ];
}

async function readDirectoryFiles(
  directory: string,
  relativePrefix: string,
): Promise<TypstSupportFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: TypstSupportFile[] = [];
  for (const entry of entries) {
    const sourcePath = path.join(directory, entry.name);
    const relativePath = path.join(relativePrefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await readDirectoryFiles(sourcePath, relativePath));
    } else if (entry.isFile()) {
      files.push({
        relativePath,
        content: await readFile(sourcePath),
      });
    }
  }
  return files;
}
