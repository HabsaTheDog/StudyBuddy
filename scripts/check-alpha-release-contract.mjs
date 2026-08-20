import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function validateAlphaReleaseContract({
  version,
  publishDraft,
  signed,
  acknowledgeUnsignedWindows,
  releaseRef,
}) {
  if (!/^0\.1\.0-alpha\.[1-9][0-9]*$/.test(version)) {
    throw new Error(`Expected an alpha version such as 0.1.0-alpha.1, received: ${version}`);
  }

  if (signed) {
    throw new Error("Signed Windows builds remain disabled until a reviewed trusted-signing integration is configured.");
  }

  if (!publishDraft) return;

  const expectedRef = `refs/tags/v${version}`;
  if (releaseRef !== expectedRef) {
    throw new Error(`Draft publication must run from ${expectedRef}.`);
  }
  if (!acknowledgeUnsignedWindows) {
    throw new Error("Unsigned Windows Alpha publication requires explicit acknowledgement.");
  }
}

function booleanEnvironmentValue(name) {
  return process.env[name] === "true";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  validateAlphaReleaseContract({
    version: process.env.RELEASE_VERSION ?? "",
    publishDraft: booleanEnvironmentValue("PUBLISH_DRAFT"),
    signed: booleanEnvironmentValue("SIGNED"),
    acknowledgeUnsignedWindows: booleanEnvironmentValue("ACKNOWLEDGE_UNSIGNED_WINDOWS"),
    releaseRef: process.env.RELEASE_REF ?? "",
  });
}
