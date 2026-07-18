import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWebLayoutRuntimeConfig } from "../config.js";
import { createValidatorNode } from "../nodes/validatorNode.js";

const tempDirs: string[] = [];
const previousWorkspace = process.env.STUDY_BUDDY_WORKSPACE;

afterEach(async () => {
  if (previousWorkspace === undefined) delete process.env.STUDY_BUDDY_WORKSPACE;
  else process.env.STUDY_BUDDY_WORKSPACE = previousWorkspace;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("web layout validator workspace preservation", () => {
  it("does not overwrite editable source files when the model returns prose", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-validator-"));
    tempDirs.push(workspace);
    process.env.STUDY_BUDDY_WORKSPACE = workspace;
    const config = createWebLayoutRuntimeConfig({
      prompt: "Repair the existing artifact",
      requestName: "preserve-source-test",
      skipBrowserValidation: true,
    });
    const sourceDir = path.join(config.runDir, "source");
    const buildDir = path.join(config.runDir, ".build");
    await Promise.all([mkdir(sourceDir, { recursive: true }), mkdir(buildDir, { recursive: true })]);
    await writeFile(path.join(sourceDir, "index.html"), "ORIGINAL HTML", "utf8");
    await writeFile(path.join(sourceDir, "styles.css"), "ORIGINAL CSS", "utf8");
    await writeFile(path.join(sourceDir, "app.js"), "ORIGINAL JS", "utf8");
    await writeFile(path.join(buildDir, "document.html"), "ORIGINAL BUILD", "utf8");

    const result = await createValidatorNode(config)({
      html_document: "Implemented the requested repairs successfully.",
      retry_count: 0,
      validator_retry_count: 0,
    } as never);

    expect(result.error_log).toContain("preserved the existing source workspace");
    await expect(readFile(path.join(sourceDir, "index.html"), "utf8")).resolves.toBe("ORIGINAL HTML");
    await expect(readFile(path.join(sourceDir, "styles.css"), "utf8")).resolves.toBe("ORIGINAL CSS");
    await expect(readFile(path.join(sourceDir, "app.js"), "utf8")).resolves.toBe("ORIGINAL JS");
    await expect(readFile(path.join(buildDir, "document.html"), "utf8")).resolves.toBe("ORIGINAL BUILD");
  });
});
