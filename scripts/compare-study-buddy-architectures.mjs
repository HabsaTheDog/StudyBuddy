import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readRunAccounting } from "./study-buddy-run-accounting.mjs";
const gates = [
  "sourceIntegrity",
  "quizPermissions",
  "coverage",
  "correctness",
  "publication",
  "artifactValidation",
];
export function compareArchitectureSamples(baseline, candidate) {
  const missing = [];
  for (const key of ["caseId", "surface", "inputHash", "settingsHash", "cacheCondition"]) {
    if (!baseline[key] || !candidate[key] || baseline[key] !== candidate[key]) missing.push(key);
  }
  if (!baseline.revision || !candidate.revision) missing.push("revision");
  const failedGates = gates.filter(
    (gate) => baseline.gates?.[gate] !== true || candidate.gates?.[gate] !== true,
  );
  const equivalent = missing.length === 0;
  const eligible = equivalent && failedGates.length === 0;
  const desktopSurface = ["desktop-dev", "desktop-installed"].includes(baseline.surface);
  const measured =
    desktopSurface &&
    eligible &&
    baseline.accounting.complete &&
    candidate.accounting.complete &&
    baseline.accounting.wallScope === "whole-turn" &&
    candidate.accounting.wallScope === "whole-turn";
  return {
    caseId: baseline.caseId,
    equivalent,
    missingOrMismatched: missing,
    failedGates,
    result: !eligible ? "reject" : measured ? "measured-pair" : "inconclusive-accounting",
    baseline: baseline.accounting,
    candidate: candidate.accounting,
    improvement: measured
      ? {
          wallMs: baseline.accounting.wallMs - candidate.accounting.wallMs,
          freshInputTokens:
            baseline.accounting.knownTokens.freshInputTokens -
            candidate.accounting.knownTokens.freshInputTokens,
          outputTokens:
            baseline.accounting.knownTokens.outputTokens -
            candidate.accounting.knownTokens.outputTokens,
        }
      : null,
    note: "One pair is a pilot, not statistical acceptance. Quality gates require source-backed review; incomplete accounting cannot establish whole-turn savings.",
  };
}
async function loadSample(sample, root) {
  if (
    !Array.isArray(sample.sourceFiles) ||
    !sample.sourceFiles.length ||
    !sample.originalPrompt ||
    !sample.modelSettings
  )
    throw new Error(
      "Declare exact prompt, frozen source files and full effective primary/fallback model settings.",
    );
  const hash = createHash("sha256").update(JSON.stringify(sample.originalPrompt));
  for (const file of sample.sourceFiles) {
    const bytes = await readFile(path.resolve(root, file));
    hash.update(JSON.stringify(bytes.length));
    hash.update(bytes);
  }
  const settingsHash = createHash("sha256")
    .update(JSON.stringify(sample.modelSettings))
    .digest("hex");
  return {
    ...sample,
    inputHash: hash.digest("hex"),
    settingsHash,
    accounting: await readRunAccounting(path.resolve(root, sample.runDir)),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2])
    throw new Error("Usage: node scripts/compare-study-buddy-architectures.mjs <manifest.json>");
  const manifestPath = path.resolve(process.argv[2]);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const root = path.dirname(manifestPath);
  const [baseline, candidate] = await Promise.all([
    loadSample(manifest.baseline, root),
    loadSample(manifest.candidate, root),
  ]);
  console.log(JSON.stringify(compareArchitectureSamples(baseline, candidate), null, 2));
}
