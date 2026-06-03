#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "src");

function candidates() {
  const configured = process.env.PYTHON ? [process.env.PYTHON] : [];
  return [
    configured,
    ["python3"],
    ["python"],
    ["py", "-3"],
  ].filter((candidate) => candidate.length > 0);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    env: options.env || process.env,
    encoding: "utf8",
    stdio: options.stdio || "pipe",
  });
}

function findPython() {
  for (const candidate of candidates()) {
    const [command, ...baseArgs] = candidate;
    const result = run(command, [...baseArgs, "-c", "import sys; print(sys.executable)"]);
    if (result.error) continue;
    if (result.status === 0) return candidate;
  }

  console.error("Could not find Python. Install Python 3 or set PYTHON to the interpreter path.");
  process.exit(127);
}

const python = findPython();
const [command, ...baseArgs] = python;
const pathSeparator = process.platform === "win32" ? ";" : ":";
const existingPythonPath = process.env.PYTHONPATH || "";
const env = {
  ...process.env,
  PYTHONPATH: existingPythonPath ? `${src}${pathSeparator}${existingPythonPath}` : src,
};

const child = spawnSync(command, [...baseArgs, ...process.argv.slice(2)], {
  cwd: root,
  env,
  stdio: "inherit",
});

if (child.error) {
  console.error(child.error.message);
  process.exit(127);
}

process.exit(child.status === null ? 1 : child.status);
