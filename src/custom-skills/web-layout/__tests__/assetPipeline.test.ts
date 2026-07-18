import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { prepareWebLayoutArtifact } from "../assetPipeline.js";
import { createWebLayoutRuntimeConfig } from "../config.js";
import { minimalValidStudyBuddyHtml } from "../htmlShell.js";
import { validateSingleFileHtml } from "../validation.js";

const execFileAsync = promisify(execFile);
const previousWorkspace = process.env.STUDY_BUDDY_WORKSPACE;
const tempDirs: string[] = [];

afterEach(async () => {
  if (previousWorkspace === undefined) delete process.env.STUDY_BUDDY_WORKSPACE;
  else process.env.STUDY_BUDDY_WORKSPACE = previousWorkspace;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("web layout media pipeline", () => {
  it("keeps editable sources and embeds approved images only in the final artifact", async () => {
    const workspace = await tempWorkspace();
    const imagePath = path.join(workspace, "diagram.svg");
    await writeFile(
      imagePath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#19254b"/></svg>',
      "utf8",
    );
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build an illustrated guide",
      requestName: "media-test",
      assetFiles: [imagePath],
      skipBrowserValidation: true,
    });
    const html = minimalValidStudyBuddyHtml({ title: "Guide", kind: "flashcards", language: "de" })
      .replace("</main>", '<figure><img src="assets/diagram.svg" alt="Block diagram"></figure></main>');

    const prepared = await prepareWebLayoutArtifact(html, config);
    const [sourceHtml, finalHtml] = await Promise.all([
      readFile(path.join(config.runDir, "source", "index.html"), "utf8"),
      readFile(prepared.report.buildPath, "utf8"),
    ]);

    expect(sourceHtml).toContain('href="styles.css"');
    expect(sourceHtml).toContain('src="app.js"');
    expect(sourceHtml).toContain('loading="lazy"');
    expect(sourceHtml).toMatch(/src="assets\/diagram-[a-f0-9]{12}\.svg"/);
    expect(finalHtml).toContain("data:image/svg+xml;base64,");
    expect(finalHtml).not.toContain("assets/diagram-");
    expect(validateSingleFileHtml(finalHtml, "flashcards").ok).toBe(true);
    expect(prepared.report.assets).toHaveLength(1);
    expect(prepared.report.artifactBytes).toBe((await stat(prepared.report.buildPath)).size);
  });

  it("refuses to emit a final artifact above the configured ceiling", async () => {
    await tempWorkspace();
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build a guide",
      requestName: "limit-test",
      maxArtifactBytes: 100,
      skipBrowserValidation: true,
    });
    const html = minimalValidStudyBuddyHtml({ title: "Guide", kind: "flashcards", language: "de" });

    await expect(prepareWebLayoutArtifact(html, config)).rejects.toThrow("exceeding the configured");
  });

  it("converts a compressible raster to WebP when ImageMagick can make it smaller", async () => {
    const workspace = await tempWorkspace();
    const imagePath = path.join(workspace, "screenshot.png");
    const available = await execFileAsync("magick", ["-version"]).then(() => true).catch(() => false);
    if (!available) return;
    await execFileAsync("magick", ["-size", "1200x800", "gradient:#ffffff-#19254b", imagePath]);
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build an illustrated guide",
      requestName: "webp-test",
      assetFiles: [imagePath],
      skipBrowserValidation: true,
    });
    const html = minimalValidStudyBuddyHtml({ title: "Guide", kind: "flashcards", language: "de" })
      .replace("</main>", '<img src="assets/screenshot.png" alt="Screenshot"></main>');

    const prepared = await prepareWebLayoutArtifact(html, config);

    expect(prepared.report.assets[0].convertedToWebp).toBe(true);
    expect(prepared.report.assets[0].mimeType).toBe("image/webp");
    expect(prepared.report.assets[0].optimizedBytes).toBeLessThan(prepared.report.assets[0].originalBytes);
  });

  it("keeps an inline WebP available when preparing a repaired artifact", async () => {
    const workspace = await tempWorkspace();
    const imagePath = path.join(workspace, "inline.webp");
    const available = await execFileAsync("magick", ["-version"]).then(() => true).catch(() => false);
    if (!available) return;
    await execFileAsync("magick", ["-size", "32x20", "xc:#19254b", imagePath]);
    const dataUri = `data:image/webp;base64,${(await readFile(imagePath)).toString("base64")}`;
    const config = createWebLayoutRuntimeConfig({
      prompt: "Repair a guide with its embedded logo",
      requestName: "inline-webp-repair-test",
      skipBrowserValidation: true,
    });
    const html = minimalValidStudyBuddyHtml({ title: "Guide", kind: "flashcards", language: "de" })
      .replace("</main>", `<img src="${dataUri}" alt="Study Buddy"></main>`);

    const prepared = await prepareWebLayoutArtifact(html, config);
    const finalHtml = await readFile(prepared.report.buildPath, "utf8");

    expect(prepared.report.assets).toHaveLength(1);
    expect(prepared.report.assets[0].mimeType).toBe("image/webp");
    expect(prepared.report.assets[0].convertedToWebp).toBe(false);
    expect(finalHtml).toContain("data:image/webp;base64,");
    expect(validateSingleFileHtml(finalHtml, "flashcards").ok).toBe(true);
  });

  it("inlines JavaScript replacement tokens literally without duplicating or corrupting HTML", async () => {
    await tempWorkspace();
    const config = createWebLayoutRuntimeConfig({
      prompt: "Bundle JavaScript containing replacement tokens",
      requestName: "literal-replacement-token-test",
      skipBrowserValidation: true,
    });
    const html = minimalValidStudyBuddyHtml({ title: "Guide", kind: "flashcards", language: "de" })
      .replace("</script>", () => "const replacementTokens = \"$& $` $'\";</script>");

    const prepared = await prepareWebLayoutArtifact(html, config);
    const finalHtml = await readFile(prepared.report.buildPath, "utf8");

    expect(finalHtml).toContain('const replacementTokens = "$& $` $\'";');
    expect(finalHtml).not.toContain('src="app.js"');
    expect(finalHtml.match(/<main\b/g)).toHaveLength(1);
    expect(validateSingleFileHtml(finalHtml, "flashcards").ok).toBe(true);
  });
});

async function tempWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-assets-"));
  tempDirs.push(workspace);
  process.env.STUDY_BUDDY_WORKSPACE = workspace;
  return workspace;
}
