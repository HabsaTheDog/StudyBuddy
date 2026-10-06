import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDesktopReleaseAssets } from "./check-desktop-release-assets.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// This tool prepares a marker, never publishes it. The GO record must be
// written after the owner approval and exact-bundle acceptance decision.
export async function createDesktopReleasePromotion({ directory, version, channel, goRecord, output }) {
  await validateDesktopReleaseAssets({ directory, version, channel, final: true, promoted: false });
  const manifestBytes = await readFile(resolve(directory, "release-manifest.json"));
  const checksumsBytes = await readFile(resolve(directory, "SHA256SUMS"));
  const manifest = JSON.parse(manifestBytes);
  const approval = JSON.parse(await readFile(goRecord, "utf8"));
  const marker = {
    schemaVersion: 1,
    product: "Study Buddy",
    version,
    channel,
    rootCommit: manifest.rootCommit,
    uiCommit: manifest.uiCommit,
    releaseManifestSha256: sha256(manifestBytes),
    sha256SumsSha256: sha256(checksumsBytes),
    downloads: {
      windows: `Study-Buddy-${version}-x64.exe`,
      linux: `Study-Buddy-${version}-x86_64.AppImage`,
    },
  };
  if (approval?.decision !== "GO" || approval.ownerApproved !== true ||
      Object.entries(marker).filter(([key]) => key !== "downloads")
        .some(([key, value]) => approval[key] !== value)) {
    throw new Error("Promotion requires an explicit owner-approved GO record bound to this exact bundle and source commits.");
  }

  // The accepted bundle remains byte-for-byte intact. Promotion is stored
  // separately for a later explicitly authorized GitHub asset upload.
  const bundlePath = await realpath(directory);
  const outputPath = resolve(await realpath(dirname(output)), basename(output));
  const outputRelative = relative(bundlePath, outputPath);
  if (!outputRelative || (!outputRelative.startsWith(`..${sep}`) && outputRelative !== "..")) {
    throw new Error("Promotion marker output must be outside the immutable accepted bundle.");
  }
  await writeFile(outputPath, `${JSON.stringify(marker, null, 2)}\n`, { flag: "wx" });
  return { output: outputPath, marker };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [directory, version, channel, recordFlag, goRecord, outputFlag, output, ...extra] = process.argv.slice(2);
  if (!directory || !version || !channel || recordFlag !== "--go-record" || !goRecord ||
      outputFlag !== "--output" || !output || extra.length) {
    throw new Error("Usage: node scripts/create-desktop-release-promotion.mjs <directory> <version> <channel> --go-record <approval.json> --output <external/distribution-ready.json>");
  }
  process.stdout.write(`${JSON.stringify(await createDesktopReleasePromotion({ directory, version, channel, goRecord, output }))}\n`);
}
