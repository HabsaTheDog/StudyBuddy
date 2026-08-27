import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta))?$/;

export function releaseMetadata(version) {
  const match = VERSION_PATTERN.exec(version);
  if (!match) {
    throw new Error(
      `Expected stable, alpha, or beta SemVer such as 1.0.0 or 0.2.0-alpha, received: ${version}`,
    );
  }
  const prereleaseKind = match[4] ?? null;
  return {
    version,
    channel: prereleaseKind ?? "latest",
    prerelease: prereleaseKind !== null,
  };
}

export function validateDesktopReleaseContract({
  version,
  publishDraft,
  signed,
  acknowledgeUnsignedWindows,
  releaseRef,
  posthogProjectToken,
}) {
  const metadata = releaseMetadata(version);

  if (signed) {
    throw new Error(
      "Signed Windows builds remain disabled until a reviewed trusted-signing integration is configured.",
    );
  }
  if (!posthogProjectToken?.startsWith("phc_") || posthogProjectToken.length < 12) {
    throw new Error(
      "VITE_POSTHOG_PROJECT_TOKEN must contain the public PostHog project token for a release build.",
    );
  }
  if (!publishDraft) return metadata;

  const expectedRef = `refs/tags/v${version}`;
  if (releaseRef !== expectedRef) {
    throw new Error(`Draft publication must run from ${expectedRef}.`);
  }
  if (!acknowledgeUnsignedWindows) {
    throw new Error("Unsigned Windows publication requires explicit acknowledgement.");
  }
  return metadata;
}

function booleanEnvironmentValue(name) {
  return process.env[name] === "true";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const metadata = validateDesktopReleaseContract({
    version: process.env.RELEASE_VERSION ?? "",
    publishDraft: booleanEnvironmentValue("PUBLISH_DRAFT"),
    signed: booleanEnvironmentValue("SIGNED"),
    acknowledgeUnsignedWindows: booleanEnvironmentValue("ACKNOWLEDGE_UNSIGNED_WINDOWS"),
    releaseRef: process.env.RELEASE_REF ?? "",
    posthogProjectToken: process.env.VITE_POSTHOG_PROJECT_TOKEN ?? "",
  });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `channel=${metadata.channel}\nprerelease=${String(metadata.prerelease)}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(metadata)}\n`);
}
