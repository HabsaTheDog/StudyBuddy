import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import { validateDesktopReleaseAssets } from "./check-desktop-release-assets.mjs";
import { createDesktopReleasePromotion } from "./create-desktop-release-promotion.mjs";

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

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function finalFixture(t) {
  const value = { ...await fixture(), channel: "alpha", final: true, promoted: false };
  t.after(() => rm(value.directory, { recursive: true, force: true }));
  await writeFile(join(value.directory, "study-buddy-root.cdx.json"),
    JSON.stringify({ bomFormat: "CycloneDX", components: [{ name: "root" }] }));
  const manifest = {
    schemaVersion: 1, product: "Study Buddy", version: value.version,
    rootCommit: "a".repeat(40), uiCommit: "b".repeat(40),
    supportedPlatforms: ["linux-x64", "windows-x64"], signed: false,
  };
  const manifestPath = join(value.directory, "release-manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  const lines = [];
  for (const name of (await readdir(value.directory)).sort()) {
    lines.push(`${sha256(await readFile(join(value.directory, name)))}  ${name}`);
  }
  const sumsPath = join(value.directory, "SHA256SUMS");
  await writeFile(sumsPath, `${lines.join("\n")}\n`);
  const marker = {
    schemaVersion: 1, product: "Study Buddy", version: value.version, channel: value.channel,
    rootCommit: manifest.rootCommit, uiCommit: manifest.uiCommit,
    releaseManifestSha256: sha256(await readFile(manifestPath)),
    sha256SumsSha256: sha256(await readFile(sumsPath)),
    downloads: {
      windows: `Study-Buddy-${value.version}-x64.exe`,
      linux: `Study-Buddy-${value.version}-x86_64.AppImage`,
    },
  };
  return { ...value, marker };
}

async function promotionFixture(t) {
  const value = await finalFixture(t);
  const approvalDirectory = await mkdtemp(join(tmpdir(), "study-buddy-promotion-"));
  t.after(() => rm(approvalDirectory, { recursive: true, force: true }));
  const { downloads: _downloads, ...binding } = value.marker;
  const approval = { ...binding, decision: "GO", ownerApproved: true };
  const goRecord = join(approvalDirectory, "go.json");
  await writeFile(goRecord, JSON.stringify(approval));
  return { ...value, approval, goRecord, output: join(approvalDirectory, "distribution-ready.json") };
}

async function bundleDigests(directory) {
  return Promise.all((await readdir(directory)).sort().map(async name =>
    [name, sha256(await readFile(join(directory, name)))]));
}

test("accepts immutable final evidence without promotion and fails closed when promotion is requested", async (t) => {
  const value = await finalFixture(t);
  assert.equal((await validateDesktopReleaseAssets(value)).assets.length, 10);
  await assert.rejects(validateDesktopReleaseAssets({ ...value, promoted: true }), /missing=\[distribution-ready.json\]/);
  await writeFile(join(value.directory, "distribution-ready.json"), JSON.stringify(value.marker));
  assert.equal((await validateDesktopReleaseAssets({ ...value, promoted: true })).assets.length, 11);
  await assert.rejects(validateDesktopReleaseAssets(value), /unexpected=\[distribution-ready.json\]/);
});

test("rejects promotion with missing or mismatched checksum, manifest, or commit binding", async (t) => {
  const value = await finalFixture(t);
  const markerPath = join(value.directory, "distribution-ready.json");
  for (const key of ["sha256SumsSha256", "releaseManifestSha256", "rootCommit", "uiCommit"]) {
    for (const replacement of [undefined, "0".repeat(key.endsWith("Sha256") ? 64 : 40)]) {
      await writeFile(markerPath, JSON.stringify({ ...value.marker, [key]: replacement }));
      await assert.rejects(validateDesktopReleaseAssets({ ...value, promoted: true }), /Distribution-ready marker is invalid/);
    }
  }
});

test("rejects checksum coverage that includes the later promotion marker", async (t) => {
  const value = await finalFixture(t);
  const markerPath = join(value.directory, "distribution-ready.json");
  await writeFile(markerPath, JSON.stringify(value.marker));
  const sumsPath = join(value.directory, "SHA256SUMS");
  const sums = `${await readFile(sumsPath, "utf8")}${"0".repeat(64)}  distribution-ready.json\n`;
  await writeFile(sumsPath, sums);
  await writeFile(markerPath, JSON.stringify({ ...value.marker, sha256SumsSha256: sha256(Buffer.from(sums)) }));
  await assert.rejects(validateDesktopReleaseAssets({ ...value, promoted: true }), /exact release asset set/);
});

test("rejects malformed, incomplete, and changed immutable checksums", async (t) => {
  const value = await finalFixture(t);
  const sumsPath = join(value.directory, "SHA256SUMS");
  const original = await readFile(sumsPath, "utf8");
  for (const [contents, error] of [
    ["invalid\n", /malformed/],
    [original + original.split("\n")[0] + "\n", /malformed/],
    [original.split("\n").slice(1).join("\n"), /exact release asset set/],
    [original.replace(/^[0-9a-f]{64}/, "0".repeat(64)), /SHA256 mismatch/],
  ]) {
    await writeFile(sumsPath, contents);
    await assert.rejects(validateDesktopReleaseAssets(value), error);
  }
  await writeFile(sumsPath, original);
  await writeFile(join(value.directory, `Study-Buddy-${value.version}-x64.exe`), "tampered");
  await assert.rejects(validateDesktopReleaseAssets(value), /wrong artifact digest|SHA256 mismatch/);
});

test("rejects release assets supplied through mutable symbolic links", async (t) => {
  const value = await finalFixture(t);
  const artifact = join(value.directory, `Study-Buddy-${value.version}-x64.exe`);
  await rm(artifact);
  await symlink("release-manifest.json", artifact);
  await assert.rejects(validateDesktopReleaseAssets(value), /Release asset is empty/);
});

test("creates deterministic promotion only from explicit exact-bundle GO without modifying accepted bytes", async (t) => {
  const value = await promotionFixture(t);
  const before = await bundleDigests(value.directory);
  const result = await createDesktopReleasePromotion(value);
  assert.deepEqual(result.marker, value.marker);
  assert.deepEqual(JSON.parse(await readFile(value.output, "utf8")), value.marker);
  assert.deepEqual(await bundleDigests(value.directory), before);
  const secondOutput = `${value.output}.second`;
  await createDesktopReleasePromotion({ ...value, output: secondOutput });
  assert.deepEqual(await readFile(secondOutput), await readFile(value.output));
  await assert.rejects(createDesktopReleasePromotion(value), /EEXIST/);
  assert.deepEqual(await bundleDigests(value.directory), before);
});

test("promotion rejects absent owner approval, non-GO decisions, and mismatched bundle provenance", async (t) => {
  const value = await promotionFixture(t);
  for (const patch of [
    { decision: "NO-GO" }, { decision: "BLOCKED" }, { ownerApproved: false }, { ownerApproved: undefined },
    { rootCommit: "c".repeat(40) }, { uiCommit: "c".repeat(40) }, { version: "0.2.1-alpha" },
    { channel: "latest" }, { sha256SumsSha256: "0".repeat(64) }, { releaseManifestSha256: "0".repeat(64) },
  ]) {
    await writeFile(value.goRecord, JSON.stringify({ ...value.approval, ...patch }));
    await assert.rejects(createDesktopReleasePromotion(value), /explicit owner-approved GO record/);
  }
  assert.equal((await readdir(value.directory)).includes("distribution-ready.json"), false);
  await assert.rejects(readFile(value.output), /ENOENT/);
});

test("promotion refuses output in the bundle, including a symlink directory alias", async (t) => {
  const value = await promotionFixture(t);
  await assert.rejects(createDesktopReleasePromotion({ ...value, output: join(value.directory, "distribution-ready.json") }), /outside the immutable/);
  const alias = join(value.directory, "..", `${value.directory.split("/").at(-1)}-alias`);
  await symlink(value.directory, alias);
  t.after(() => rm(alias));
  await assert.rejects(createDesktopReleasePromotion({ ...value, output: join(alias, "distribution-ready.json") }), /outside the immutable/);
});

test("promotion fails before output when accepted bundle bytes change", async (t) => {
  const value = await promotionFixture(t);
  await writeFile(join(value.directory, `Study-Buddy-${value.version}-x64.exe.blockmap`), "changed after acceptance");
  await assert.rejects(createDesktopReleasePromotion(value), /SHA256 mismatch/);
  await assert.rejects(readFile(value.output), /ENOENT/);
});

test("workflow assembles and stages drafts without any automatic promotion", async () => {
  const workflow = await readFile(new URL("../.github/workflows/alpha-release.yml", import.meta.url), "utf8");
  assert.equal((workflow.match(/--final --unpromoted/g) ?? []).length, 2);
  assert.match(workflow, /test ! -e distribution-ready\.json/);
  assert.doesNotMatch(workflow, /create-desktop-release-promotion|distribution-ready.*writeFile|writeFile.*distribution-ready/);
});
