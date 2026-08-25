import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import { validateDesktopReleaseAssets } from "./check-desktop-release-assets.mjs";

async function fixture(extra = []) {
  const directory = await mkdtemp(join(tmpdir(), "study-buddy-release-assets-"));
  const version = "1.0.0";
  const names = [
    "latest-linux.yml",
    "latest.yml",
    `Study-Buddy-${version}-x64.exe`,
    `Study-Buddy-${version}-x64.exe.blockmap`,
    `Study-Buddy-${version}-x86_64.AppImage`,
    `Study-Buddy-${version}-x86_64.AppImage.blockmap`,
  ];
  for (const name of names.filter((name) => !name.endsWith(".yml"))) {
    await writeFile(join(directory, name), `artifact:${name}`);
  }
  for (const [manifest, artifact] of [
    ["latest.yml", `Study-Buddy-${version}-x64.exe`],
    ["latest-linux.yml", `Study-Buddy-${version}-x86_64.AppImage`],
  ]) {
    const artifactBytes = await readFile(join(directory, artifact));
    const digest = createHash("sha512").update(artifactBytes).digest("base64");
    await writeFile(
      join(directory, manifest),
      `version: ${version}\npath: ${artifact}\nsha512: ${digest}\n`,
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
    channel: "latest",
  });
  assert.equal(result.assets.length, 8);
});

test("rejects builder debug metadata and any other unexpected asset", async (t) => {
  const value = await fixture(["builder-debug.yml"]);
  t.after(() => rm(value.directory, { recursive: true, force: true }));
  await assert.rejects(
    validateDesktopReleaseAssets({
      directory: value.directory,
      version: value.version,
      channel: "latest",
    }),
    /builder-debug\.yml/,
  );
});

test("rejects a missing blockmap", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.directory, { recursive: true, force: true }));
  await rm(join(value.directory, `Study-Buddy-${value.version}-x64.exe.blockmap`));
  await assert.rejects(
    validateDesktopReleaseAssets({
      directory: value.directory,
      version: value.version,
      channel: "latest",
    }),
    /missing=/,
  );
});

test("rejects a manifest for another release version", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.directory, { recursive: true, force: true }));
  await writeFile(join(value.directory, "latest.yml"), "version: 9.9.9\npath: nope\nsha512: nope\n");
  await assert.rejects(
    validateDesktopReleaseAssets({
      directory: value.directory,
      version: value.version,
      channel: "latest",
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
      channel: "latest",
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
      channel: "latest",
    }),
    /invalid or empty/,
  );
});

test("accepts final evidence only when its manifest and checksums are internally consistent", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.directory, { recursive: true, force: true }));
  const sbom = JSON.stringify({ bomFormat: "CycloneDX", components: [{ name: "root" }] });
  await writeFile(join(value.directory, "study-buddy-root.cdx.json"), sbom);
  await writeFile(
    join(value.directory, "release-manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      product: "Study Buddy",
      version: value.version,
      rootCommit: "a".repeat(40),
      uiCommit: "b".repeat(40),
      supportedPlatforms: ["linux-x64", "windows-x64"],
      signed: false,
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
    channel: "latest",
    final: true,
  });
  assert.equal(result.assets.length, 11);

  await writeFile(join(value.directory, `Study-Buddy-${value.version}-x64.exe`), "tampered");
  await assert.rejects(
    validateDesktopReleaseAssets({
      directory: value.directory,
      version: value.version,
      channel: "latest",
      final: true,
    }),
    /wrong artifact digest|SHA256 mismatch/,
  );
});
