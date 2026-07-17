import { copyFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";

export function createDiskWriterNode(config: WebLayoutRuntimeConfig) {
  return async function diskWriterNode(state: LangGraphWebLayoutState): Promise<Partial<LangGraphWebLayoutState>> {
    if (!state.html_document.trim()) {
      return { error_log: "Disk writer failed: html_document is empty." };
    }
    await Promise.all([
      mkdir(config.runDir, { recursive: true }),
      mkdir(path.dirname(config.outputPath), { recursive: true }),
    ]);
    const buildPath = path.join(config.runDir, ".build", "document.html");
    const buildStat = await stat(buildPath).catch(() => null);
    if (!buildStat?.isFile() || buildStat.size === 0) {
      return { error_log: "Disk writer failed: validated bundled HTML artifact is missing." };
    }
    if (buildStat.size > config.maxArtifactBytes) {
      return { error_log: `Disk writer refused ${buildStat.size} byte artifact above ${config.maxArtifactBytes} byte limit.` };
    }
    await moveValidatedBuild(buildPath, config.outputPath);
    await Promise.all([
      writeFile(path.join(config.runDir, "source.txt"), state.source_text, "utf8"),
      writeFile(path.join(config.runDir, "layout-spec.json"), `${JSON.stringify(state.layout_spec, null, 2)}\n`, "utf8"),
      writeFile(path.join(config.runDir, "validation-report.json"), `${JSON.stringify(state.validation_report, null, 2)}\n`, "utf8"),
      writeFile(path.join(config.runDir, "state.json"), `${JSON.stringify({
        ...state,
        source_text: state.source_text ? "[see source.txt]" : "",
        html_document: state.html_document ? "[see source/index.html and document.html]" : "",
      }, null, 2)}\n`, "utf8"),
      writeFile(path.join(config.runDir, "error.log"), "", "utf8"),
    ]);
    await config.diagnostics?.log("info", "disk", `Wrote HTML document: ${config.outputPath}`);
    return { error_log: null };
  };
}

async function moveValidatedBuild(sourcePath: string, outputPath: string): Promise<void> {
  try {
    await rename(sourcePath, outputPath);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code !== "EXDEV") throw error;
    await copyFile(sourcePath, outputPath);
    await rm(sourcePath, { force: true });
  }
}
