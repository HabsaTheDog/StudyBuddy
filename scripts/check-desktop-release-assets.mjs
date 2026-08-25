import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

function expectedBuildAssets(version, channel) {
  return [
    `${channel}-linux.yml`,
    `${channel}.yml`,
    `Study-Buddy-${version}-x64.exe`,
    `Study-Buddy-${version}-x64.exe.blockmap`,
    `Study-Buddy-${version}-x86_64.AppImage`,
    `Study-Buddy-${version}-x86_64.AppImage.blockmap`,
    "study-buddy-desktop-linux-x64.cdx.json",
    "study-buddy-desktop-windows-x64.cdx.json",
  ].sort();
}

function manifestScalar(contents, key) {
  const match = contents.match(new RegExp(`^${key}:\\s*["']?([^"'\\r\\n]+)["']?\\s*$`, "m"));
  return match?.[1]?.trim() ?? null;
}

async function digestFile(path, algorithm, encoding) {
  return createHash(algorithm).update(await readFile(path)).digest(encoding);
}

export async function validateDesktopReleaseAssets({ directory, version, channel, final = false }) {
  const expected = expectedBuildAssets(version, channel);
  if (final) {
    expected.push(
      "SHA256SUMS",
      "release-manifest.json",
      "study-buddy-root.cdx.json",
    );
    expected.sort();
  }

  const names = (await readdir(directory)).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    const missing = expected.filter((name) => !names.includes(name));
    const unexpected = names.filter((name) => !expected.includes(name));
    throw new Error(
      `Release asset allowlist mismatch; missing=[${missing.join(", ")}], unexpected=[${unexpected.join(", ")}]`,
    );
  }
  for (const name of names) {
    const info = await stat(resolve(directory, name));
    if (!info.isFile() || info.size === 0) throw new Error(`Release asset is empty: ${name}`);
  }
  const updaterTargets = new Map([
    [`${channel}.yml`, `Study-Buddy-${version}-x64.exe`],
    [`${channel}-linux.yml`, `Study-Buddy-${version}-x86_64.AppImage`],
  ]);
  for (const [manifest, artifact] of updaterTargets) {
    const contents = await readFile(resolve(directory, manifest), "utf8");
    if (manifestScalar(contents, "version") !== version) {
      throw new Error(`Updater manifest is incomplete or has the wrong version: ${manifest}`);
    }
    if (manifestScalar(contents, "path") !== artifact) {
      throw new Error(`Updater manifest points to the wrong artifact: ${manifest}`);
    }
    const expectedSha512 = await digestFile(resolve(directory, artifact), "sha512", "base64");
    if (manifestScalar(contents, "sha512") !== expectedSha512) {
      throw new Error(`Updater manifest has the wrong artifact digest: ${manifest}`);
    }
  }
  for (const sbom of [
    "study-buddy-desktop-linux-x64.cdx.json",
    "study-buddy-desktop-windows-x64.cdx.json",
    ...(final ? ["study-buddy-root.cdx.json"] : []),
  ]) {
    const parsed = JSON.parse(await readFile(resolve(directory, sbom), "utf8"));
    if (parsed.bomFormat !== "CycloneDX" || !Array.isArray(parsed.components) || !parsed.components.length) {
      throw new Error(`Artifact SBOM is invalid or empty: ${sbom}`);
    }
  }
  if (final) {
    const releaseManifest = JSON.parse(
      await readFile(resolve(directory, "release-manifest.json"), "utf8"),
    );
    if (
      releaseManifest.schemaVersion !== 1 ||
      releaseManifest.product !== "Study Buddy" ||
      releaseManifest.version !== version ||
      !/^[0-9a-f]{40}$/u.test(releaseManifest.rootCommit ?? "") ||
      !/^[0-9a-f]{40}$/u.test(releaseManifest.uiCommit ?? "") ||
      JSON.stringify(releaseManifest.supportedPlatforms) !==
        JSON.stringify(["linux-x64", "windows-x64"]) ||
      typeof releaseManifest.signed !== "boolean"
    ) {
      throw new Error("Release manifest is invalid or does not describe this release.");
    }

    const checksumLines = (await readFile(resolve(directory, "SHA256SUMS"), "utf8"))
      .trim()
      .split(/\r?\n/u);
    const checksums = new Map();
    for (const line of checksumLines) {
      const match = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/u);
      if (!match || checksums.has(match[2])) throw new Error("SHA256SUMS is malformed.");
      checksums.set(match[2], match[1]);
    }
    const checksummedNames = names.filter((name) => name !== "SHA256SUMS");
    if (
      JSON.stringify([...checksums.keys()].sort()) !== JSON.stringify(checksummedNames.sort())
    ) {
      throw new Error("SHA256SUMS does not cover the exact release asset set.");
    }
    for (const name of checksummedNames) {
      const actual = await digestFile(resolve(directory, name), "sha256", "hex");
      if (checksums.get(name) !== actual) throw new Error(`SHA256 mismatch: ${name}`);
    }
  }
  return { version, channel, final, assets: names };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [directory, version, channel, finalFlag] = process.argv.slice(2);
  if (!directory || !version || !channel) {
    throw new Error(
      "Usage: node scripts/check-desktop-release-assets.mjs <directory> <version> <channel> [--final]",
    );
  }
  const result = await validateDesktopReleaseAssets({
    directory,
    version,
    channel,
    final: finalFlag === "--final",
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
