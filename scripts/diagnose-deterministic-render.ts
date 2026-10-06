import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderDeterministicStudyDocument } from "../src/custom-skills/moodle/deterministicTypstRenderer.js";
import { replaceFailingInlineMathWithReadableText } from "../src/custom-skills/moodle/nodes/formatterNode.js";
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
let document = renderDeterministicStudyDocument(data, coverage, { profile: "study_guide" });
const supportFiles = await getStudyBuddyTypstSupportFiles();
let downgradedMath = 0;
let validation = await validateTypst(document, supportFiles, { assetBaseDir: path.join(runDir, "render") });
while (!validation.ok && downgradedMath < 16) {
  const repaired = replaceFailingInlineMathWithReadableText(document, validation.error);
  if (!repaired || repaired === document) break;
  document = repaired;
  downgradedMath += 1;
  validation = await validateTypst(document, supportFiles, { assetBaseDir: path.join(runDir, "render") });
}
process.stdout.write(`${JSON.stringify({ examples: data.worked_examples.length, characters: document.length, downgradedMath, ...validation })}\n`);
if (!validation.ok) process.exitCode = 1;
