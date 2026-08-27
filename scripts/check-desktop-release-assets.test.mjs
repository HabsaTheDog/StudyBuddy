import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import { validateDesktopReleaseAssets } from "./check-desktop-release-assets.mjs";

async function fixture(extra = []) {
  const directory = await mkdtemp(join(tmpdir(), "study-buddy-release-assets-"));
  const version = "0.2.0-alpha";
  const names = [
    "alpha-linux.yml",
    "alpha.yml",
    `Study-Buddy-${version}-x64.exe`,
    `Study-Buddy-${version}-x64.exe.blockmap`,
    `Study-Buddy-${version}-x86_64.AppImage`,
  ];
  for (const name of names.filter((name) => !name.endsWith(".yml"))) {
    await writeFile(join(directory, name), `artifact:${name}`);
  }
  for (const [manifest, artifact] of [
    ["alpha.yml", `Study-Buddy-${version}-x64.exe`],
    ["alpha-linux.yml", `Study-Buddy-${version}-x86_64.AppImage`],
  ]) {
    const artifactBytes = await readFile(join(directory, artifact));
    const digest = createHash("sha512").update(artifactBytes).digest("base64");
    await writeFile(
      join(directory, manifest),
      `version: ${version}\nfiles:\n  - url: ${artifact}\n    sha512: ${digest}\n${manifest === "alpha-linux.yml" ? "    blockMapSize: 1234\n" : ""}path: ${artifact}\nsha512: ${digest}\n`,
    );
  }
  const sbom = JSON.stringify({ bomFormat: "CycloneDX", components: [{ name: "Study Buddy" }] });
  await writeFile(join(directory, "study-buddy-desktop-linux-x64.cdx.json"), sbom);
  await writeFile(join(directory, "study-buddy-desktop-windows-x64.cdx.json"), sbom);
  for (const name of extra) await writeFile(join(directory, name), "unexpected");
  return { directory, version };
}

test("accepts the exact build asset allowlist", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.directory, { recursive: true, force: true }));
  const result = await validateDesktopReleaseAssets({
    directory: value.directory,
    version: value.version,
    channel: "alpha",
  });
  assert.equal(result.assets.length, 7);
});

test("rejects builder debug metadata and any other unexpected asset", async (t) => {
  const value = await fixture(["builder-debug.yml"]);
  t.after(() => rm(value.directory, { recursive: true, force: true }));
  await assert.rejects(
    validateDesktopReleaseAssets({
      directory: value.directory,
      version: value.version,
      channel: "alpha",
    }),
    /builder-debug\.yml/,
  );
});

test("rejects a missing Windows blockmap", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.directory, { recursive: true, force: true }));
  await rm(join(value.directory, `Study-Buddy-${value.version}-x64.exe.blockmap`));
  await assert.rejects(
    validateDesktopReleaseAssets({
      directory: value.directory,
      version: value.version,
      channel: "alpha",
    }),
    /missing=/,
  );
});

test("rejects a Linux manifest without an embedded AppImage block map", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.directory, { recursive: true, force: true }));
  const artifact = `Study-Buddy-${value.version}-x86_64.AppImage`;
  const digest = createHash("sha512")
    .update(await readFile(join(value.directory, artifact)))
    .digest("base64");
  await writeFile(
    join(value.directory, "alpha-linux.yml"),
    `version: ${value.version}\npath: ${artifact}\nsha512: ${digest}\n`,
  );
  await assert.rejects(
    validateDesktopReleaseAssets({
      directory: value.directory,
      version: value.version,
      channel: "alpha",
    }),
    /no embedded AppImage block map/,
  );
});

test("rejects a manifest for another release version", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.directory, { recursive: true, force: true }));
  await writeFile(join(value.directory, "alpha.yml"), "version: 9.9.9\npath: nope\nsha512: nope\n");
  await assert.rejects(
    validateDesktopReleaseAssets({
      directory: value.directory,
      version: value.version,
      channel: "alpha",
    }),
    /wrong version/,
  );
});

test("rejects an empty artifact", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.directory, { recursive: true, force: true }));
  await writeFile(join(value.directory, `Study-Buddy-${value.version}-x64.exe`), "");
  await assert.rejects(
    validateDesktopReleaseAssets({
      directory: value.directory,
      version: value.version,
      channel: "alpha",
    }),
    /empty/,
  );
});

test("rejects an invalid artifact SBOM", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.directory, { recursive: true, force: true }));
  await writeFile(
    join(value.directory, "study-buddy-desktop-windows-x64.cdx.json"),
    JSON.stringify({ bomFormat: "CycloneDX", components: [] }),
  );
  await assert.rejects(
    validateDesktopReleaseAssets({
      directory: value.directory,
      version: value.version,
      channel: "alpha",
    }),
    /invalid or empty/,
  );
});

test("accepts final evidence only when its manifest and checksums are internally consistent", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.directory, { recursive: true, force: true }));
  const sbom = JSON.stringify({ bomFormat: "CycloneDX", components: [{ name: "root" }] });
  await writeFile(join(value.directory, "study-buddy-root.cdx.json"), sbom);
  const releaseManifest = {
    schemaVersion: 1,
    product: "Study Buddy",
    version: value.version,
    rootCommit: "a".repeat(40),
    uiCommit: "b".repeat(40),
    supportedPlatforms: ["linux-x64", "windows-x64"],
    signed: false,
  };
  const releaseManifestPath = join(value.directory, "release-manifest.json");
  await writeFile(releaseManifestPath, JSON.stringify(releaseManifest));
  const releaseManifestSha256 = createHash("sha256")
    .update(await readFile(releaseManifestPath))
    .digest("hex");
  await writeFile(
    join(value.directory, "distribution-ready.json"),
    JSON.stringify({
      schemaVersion: 1,
      product: "Study Buddy",
      version: value.version,
      channel: "alpha",
      rootCommit: releaseManifest.rootCommit,
      uiCommit: releaseManifest.uiCommit,
      releaseManifestSha256,
      downloads: {
        windows: `Study-Buddy-${value.version}-x64.exe`,
        linux: `Study-Buddy-${value.version}-x86_64.AppImage`,
      },
    }),
  );
  const names = (await readdir(value.directory)).sort();
  const lines = [];
  for (const name of names) {
    const digest = createHash("sha256")
      .update(await readFile(join(value.directory, name)))
      .digest("hex");
    lines.push(`${digest}  ${name}`);
  }
  await writeFile(join(value.directory, "SHA256SUMS"), `${lines.join("\n")}\n`);

  const result = await validateDesktopReleaseAssets({
    directory: value.directory,
    version: value.version,
    channel: "alpha",
    final: true,
  });
  assert.equal(result.assets.length, 11);

  const distributionPath = join(value.directory, "distribution-ready.json");
  const distributionContents = await readFile(distributionPath, "utf8");
  await writeFile(distributionPath, JSON.stringify({ version: value.version }));
  await assert.rejects(
    validateDesktopReleaseAssets({
      directory: value.directory,
      version: value.version,
      channel: "alpha",
      final: true,
    }),
    /Distribution-ready marker is invalid/,
  );
  await writeFile(distributionPath, distributionContents);

  await writeFile(join(value.directory, `Study-Buddy-${value.version}-x64.exe`), "tampered");
  await assert.rejects(
    validateDesktopReleaseAssets({
      directory: value.directory,
      version: value.version,
      channel: "alpha",
      final: true,
    }),
    /wrong artifact digest|SHA256 mismatch/,
  );
});
