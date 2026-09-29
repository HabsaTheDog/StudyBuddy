import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderDeterministicStudyDocument } from "../src/custom-skills/moodle/deterministicTypstRenderer.js";
import type { SourceCoverage } from "../src/custom-skills/moodle/runDiagnostics.js";
import { getStudyBuddyTypstSupportFiles } from "../src/custom-skills/moodle/typstAssets.js";
import { validateExtractedData, validateTypst } from "../src/custom-skills/moodle/validation.js";

const runDir = process.argv[2];
if (!runDir) {
  throw new Error("Usage: tsx scripts/diagnose-deterministic-render.ts <combined-run-dir>");
}

const extractionDir = path.join(runDir, "extraction");
const data = validateExtractedData(JSON.parse(await readFile(path.join(extractionDir, "extracted-data.json"), "utf8")));
const coverage = JSON.parse(await readFile(path.join(extractionDir, "source_coverage.json"), "utf8")) as SourceCoverage;
const document = renderDeterministicStudyDocument(data, coverage, { profile: "study_guide" });
const validation = await validateTypst(document, await getStudyBuddyTypstSupportFiles(), {
  assetBaseDir: path.join(runDir, "render"),
});
process.stdout.write(`${JSON.stringify({ examples: data.worked_examples.length, characters: document.length, ...validation })}\n`);
if (!validation.ok) process.exitCode = 1;
