#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(
  npm,
  ["sbom", "--omit=dev", "--sbom-format=cyclonedx"],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);

if (result.status !== 0) {
  process.stderr.write(result.stderr || "npm sbom failed without diagnostics.\n");
  process.exit(result.status ?? 1);
}

try {
  const sbom = JSON.parse(result.stdout);
  if (
    sbom.bomFormat !== "CycloneDX" ||
    typeof sbom.specVersion !== "string" ||
    !Array.isArray(sbom.components) ||
    sbom.components.length === 0
  ) {
    throw new Error("SBOM is missing the CycloneDX metadata or production components.");
  }
  console.log(`CycloneDX SBOM generation passed (${sbom.components.length} production components).`);
} catch (error) {
  console.error(`CycloneDX SBOM validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
