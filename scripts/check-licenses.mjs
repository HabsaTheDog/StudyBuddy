#!/usr/bin/env node

import { readFileSync } from "node:fs";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const allowed = new Set(["Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MIT", "MPL-2.0"]);
const inventory = new Map();
const failures = [];

for (const [packagePath, metadata] of Object.entries(lock.packages ?? {})) {
  if (!packagePath.startsWith("node_modules/") || metadata.dev === true) continue;
  const name = packagePath.slice("node_modules/".length);
  const license = metadata.license;
  inventory.set(license ?? "UNKNOWN", (inventory.get(license ?? "UNKNOWN") ?? 0) + 1);
  if (!license || !allowed.has(license)) {
    failures.push(`${name}: ${license ?? "missing license metadata"}`);
  }
}

console.log(
  [...inventory.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([license, count]) => `${license}: ${count}`)
    .join("\n"),
);

if (failures.length > 0) {
  console.error(`Unreviewed production dependency licenses:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Production dependency license policy passed.");
}
