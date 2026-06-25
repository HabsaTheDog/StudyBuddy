import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";

export function createDiskWriterNode(config: WebLayoutRuntimeConfig) {
  return async function diskWriterNode(state: LangGraphWebLayoutState): Promise<Partial<LangGraphWebLayoutState>> {
    if (!state.html_document.trim()) {
      return { error_log: "Disk writer failed: html_document is empty." };
    }
    await mkdir(config.runDir, { recursive: true });
    await Promise.all([
      writeFile(path.join(config.runDir, "source.txt"), state.source_text, "utf8"),
      writeFile(path.join(config.runDir, "layout-spec.json"), `${JSON.stringify(state.layout_spec, null, 2)}\n`, "utf8"),
      writeFile(config.outputPath, state.html_document, "utf8"),
      writeFile(path.join(config.runDir, "validation-report.json"), `${JSON.stringify(state.validation_report, null, 2)}\n`, "utf8"),
      writeFile(path.join(config.runDir, "state.json"), `${JSON.stringify({
        ...state,
        source_text: state.source_text ? "[see source.txt]" : "",
        html_document: state.html_document ? "[see document.html]" : "",
      }, null, 2)}\n`, "utf8"),
      writeFile(path.join(config.runDir, "error.log"), "", "utf8"),
    ]);
    await config.diagnostics?.log("info", "disk", `Wrote HTML document: ${config.outputPath}`);
    return { error_log: null };
  };
}
