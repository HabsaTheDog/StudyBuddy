import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import {
  compileTypstPdf,
  ensureInside,
  writeTypstSupportFiles,
} from "../validation.js";
import {
  getStudyBuddyTypstSupportFiles,
  studyBuddyTypstPackagePath,
} from "../typstAssets.js";
import { typstPdfPath } from "../typstTemplate.js";
import { writeRunProgress } from "../runProgress.js";

export function createDiskWriterNode(config: MoodleRuntimeConfig) {
  return async function diskWriterNode(state: LangGraphAgentState): Promise<Partial<LangGraphAgentState>> {
    if (!state.final_document.trim()) {
      return {
        error_log: "Disk writer failed: final_document is empty.",
      };
    }
    const outputPath = ensureInside(config.runDir, config.outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    const supportFiles = await getStudyBuddyTypstSupportFiles();
    await writeTypstSupportFiles(config.runDir, supportFiles);
    await writeFile(outputPath, state.final_document, "utf8");
    await config.diagnostics?.log("info", "typst", `Wrote Typst document: ${outputPath}`);
    await writeRunProgress(config, {
      phase: "rendering_pdf",
      artifacts: { typstPath: outputPath },
    });
    const pdfPath = ensureInside(config.runDir, typstPdfPath(outputPath));
    const pdfResult = await compileTypstPdf(outputPath, pdfPath, {
      packagePath: studyBuddyTypstPackagePath(config.runDir),
      signal: config.abortSignal,
    });
    if (!pdfResult.ok) {
      return {
        error_log: `PDF compile failed: ${pdfResult.error}`,
      };
    }
    await config.diagnostics?.log("info", "typst", `Wrote PDF document: ${pdfPath}`);
    await writeRunProgress(config, {
      phase: "finalizing",
      artifacts: { typstPath: outputPath, pdfPath },
    });
    return { error_log: null };
  };
}
