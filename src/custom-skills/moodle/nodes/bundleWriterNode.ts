import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { ArtifactBundleSchema } from "../examNavigatorContracts.js";
import { renderStudentFirstHtml } from "../studentFirstHtmlRenderer.js";
import { typstPdfPath } from "../typstTemplate.js";
import { validateWebLayoutHtml } from "../../web-layout/validation.js";

export function createBundleWriterNode(config: MoodleRuntimeConfig) {
  return async function bundleWriterNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    try {
      const { model, manifest } = await materializePortableSources(config.runDir, state);
      const htmlPath = path.join(config.runDir, "document.html");
      let reviewReport = state.review_report;
      if (config.artifactIntent.formats.includes("html")) {
        const html = renderStudentFirstHtml(model, config.runDir);
        await writeFile(htmlPath, html, "utf8");
        const htmlValidation = await validateWebLayoutHtml(html, "reference", {
          runDir: config.runDir,
          headed: !config.headless,
        });
        await writeJson(path.join(config.runDir, "html-validation-report.json"), htmlValidation);
        if (!htmlValidation.ok) {
          reviewReport = {
            ...reviewReport,
            ok: false,
            findings: [
              ...reviewReport.findings,
              ...htmlValidation.issues.map((issue) => ({
                gate: "ux" as const,
                severity: "error" as const,
                code: issue.code,
                message: issue.message,
              })),
            ],
          };
        }
      }
      await Promise.all([
        writeJson(path.join(config.runDir, "source-map.json"), manifest),
        writeJson(path.join(config.runDir, "evidence-package.json"), state.evidence_package),
        writeJson(path.join(config.runDir, "coverage-report.json"), state.coverage_assessment),
        writeJson(path.join(config.runDir, "review-report.json"), reviewReport),
        writeJson(path.join(config.runDir, "study-model.json"), model),
      ]);
      const pdfPath = typstPdfPath(config.outputPath);
      const artifactBundle = ArtifactBundleSchema.parse({
        status: state.coverage_assessment.status,
        htmlPath: config.artifactIntent.formats.includes("html") ? htmlPath : undefined,
        pdfPath:
          config.artifactIntent.formats.includes("pdf") && await isNonEmptyFile(pdfPath)
            ? pdfPath
            : undefined,
        sourceMapPath: path.join(config.runDir, "source-map.json"),
        evidencePath: path.join(config.runDir, "evidence-package.json"),
        coverageReportPath: path.join(config.runDir, "coverage-report.json"),
        reviewReportPath: path.join(config.runDir, "review-report.json"),
      });
      await writeJson(path.join(config.runDir, "artifact-bundle.json"), artifactBundle);
      return {
        study_model: model,
        resource_manifest: manifest,
        review_report: reviewReport,
        artifact_bundle: artifactBundle,
        error_log: reviewReport.ok ? null : "Artifact bundle failed student-first UX review.",
      };
    } catch (error) {
      return {
        error_log: `Artifact bundle failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}

async function materializePortableSources(
  runDir: string,
  state: LangGraphAgentState,
): Promise<{
  model: LangGraphAgentState["study_model"];
  manifest: LangGraphAgentState["resource_manifest"];
}> {
  const sourcesDir = path.join(runDir, "sources");
  await mkdir(sourcesDir, { recursive: true });
  const copied = new Map<string, string>();
  const copySource = async (sourcePath: string | null): Promise<string | null> => {
    if (!sourcePath || !await isNonEmptyFile(sourcePath)) return null;
    const existing = copied.get(sourcePath);
    if (existing) return existing;
    const target = path.join(sourcesDir, safeBasename(sourcePath));
    if (path.resolve(sourcePath) !== path.resolve(target)) {
      await copyFile(sourcePath, target);
    }
    copied.set(sourcePath, target);
    return target;
  };

  const resources = [];
  for (const resource of state.resource_manifest.resources) {
    const localPath = await copySource(resource.localPath);
    const previewPath = resource.previewPath === resource.localPath
      ? localPath
      : await copySource(resource.previewPath);
    resources.push({ ...resource, localPath, previewPath });
  }
  const sourceMap = new Map(resources.map((resource) => [resource.originUrl, resource]));
  const sources = [];
  for (const source of state.study_model.sources) {
    const resource = source.originUrl ? sourceMap.get(source.originUrl) : undefined;
    const localPath = resource?.localPath ?? await copySource(source.localPath);
    const previewPath = resource?.previewPath ??
      (source.previewPath === source.localPath ? localPath : await copySource(source.previewPath));
    sources.push({ ...source, localPath, previewPath });
  }
  return {
    model: { ...state.study_model, sources },
    manifest: { ...state.resource_manifest, resources },
  };
}

async function isNonEmptyFile(filePath: string): Promise<boolean> {
  const fileStat = await stat(filePath).catch(() => null);
  return Boolean(fileStat?.isFile() && fileStat.size > 0);
}

function safeBasename(filePath: string): string {
  return path.basename(filePath).replace(/[^a-z0-9äöüß._-]+/gi, "-");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
