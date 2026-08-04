#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean)
  .filter((file) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  });
const failures = [];
const forbiddenPaths = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:cookies?|storage[-_]?state).*\.json$/i,
  /\.(?:key|pem|p12|pfx|jks|keystore|sqlite3?|db|log)$/i,
  /^study-buddy-data\//,
  /^\.playwright(?:-cli)?\//,
];

for (const file of files) {
  if (file === ".env.example") continue;
  if (forbiddenPaths.some((pattern) => pattern.test(file))) {
    failures.push(`forbidden tracked path: ${file}`);
  }
  if (!/\.(?:md|ts|json|yml|yaml|sh|ps1|toml)$/i.test(file)) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (/\/home\/alvaroschroll\//i.test(text)) {
    failures.push(`maintainer-local absolute path: ${file}`);
  }
  if (/moodle\.technikum-wien\.at\/mod\/quiz\/attempt\.php\?attempt=\d+/i.test(text)) {
    failures.push(`real-looking Moodle attempt URL: ${file}`);
  }
  if (/moodle\.technikum-wien\.at[^\s\"']*(?:id|attempt|cmid)=\d{5,}/i.test(text)) {
    failures.push(`real-looking institution resource identifier: ${file}`);
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
    failures.push(`private-key material: ${file}`);
  }
}

const diff = spawnSync("git", ["diff", "--check"], { encoding: "utf8" });
if (diff.status !== 0) failures.push(diff.stdout || diff.stderr || "git diff --check failed");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked ${files.length} candidate public paths: public-tree policy passed.`);
}
