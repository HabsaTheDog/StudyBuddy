#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { ABSOLUTE_MAX_ARTIFACT_BYTES, DEFAULT_MAX_ARTIFACT_BYTES } from "./config.js";
import { bundleWebLayoutSource } from "./assetPipeline.js";

const program = new Command()
  .name("web-layout-bundle")
  .description("Compile an editable Study Buddy web-layout source directory into one offline HTML file.")
  .argument("<source-dir>", "Directory containing index.html, styles.css, app.js, and assets/")
  .option("--out <path>", "Output HTML path")
  .option(
    "--max-artifact-mb <number>",
    "Maximum output size in decimal MB (1-250)",
    parseMegabytes,
    DEFAULT_MAX_ARTIFACT_BYTES / 1_000_000,
  )
  .parse(process.argv);

const sourceDir = path.resolve(program.args[0]);
const options = program.opts<{ out?: string; maxArtifactMb: number }>();
const outputPath = path.resolve(options.out ?? path.join(sourceDir, "..", "document.html"));
const result = await bundleWebLayoutSource({
  sourceDir,
  outputPath,
  maxArtifactBytes: options.maxArtifactMb * 1_000_000,
});
console.log(`Wrote HTML document: ${outputPath}`);
console.log(`Artifact bytes: ${result.artifactBytes}`);

function parseMegabytes(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed * 1_000_000 > ABSOLUTE_MAX_ARTIFACT_BYTES) {
    throw new Error(`Expected artifact size from 1 to ${ABSOLUTE_MAX_ARTIFACT_BYTES / 1_000_000} MB, got ${value}`);
  }
  return parsed;
}
