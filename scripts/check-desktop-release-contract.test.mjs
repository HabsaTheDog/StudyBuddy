import test from "node:test";
import assert from "node:assert/strict";

import {
  releaseMetadata,
  validateDesktopReleaseContract,
} from "./check-desktop-release-contract.mjs";

const base = {
  version: "1.0.0",
  publishDraft: false,
  signed: false,
  acknowledgeUnsignedWindows: false,
  releaseRef: "refs/heads/release/stable-rc",
  posthogProjectToken: "phc_public-project-token",
};

test("derives stable and prerelease channels", () => {
  assert.deepEqual(releaseMetadata("1.0.0"), {
    version: "1.0.0",
    channel: "latest",
    prerelease: false,
  });
  assert.deepEqual(releaseMetadata("1.1.0-alpha.3"), {
    version: "1.1.0-alpha.3",
    channel: "alpha",
    prerelease: true,
  });
  assert.deepEqual(releaseMetadata("1.1.0-beta.2"), {
    version: "1.1.0-beta.2",
    channel: "beta",
    prerelease: true,
  });
});

test("rejects unsupported prerelease identifiers and malformed versions", () => {
  for (const version of ["v1.0.0", "1.0", "1.0.0-rc.1", "01.0.0", "1.0.0-alpha.0"]) {
    assert.throws(() => releaseMetadata(version));
  }
});

test("requires the public PostHog token even for a non-publishing release build", () => {
  assert.throws(
    () => validateDesktopReleaseContract({ ...base, posthogProjectToken: "" }),
    /public PostHog project token/,
  );
});

test("allows an unsigned exact-tag publication only with acknowledgement", () => {
  const tagged = {
    ...base,
    publishDraft: true,
    releaseRef: "refs/tags/v1.0.0",
  };
  assert.throws(() => validateDesktopReleaseContract(tagged), /explicit acknowledgement/);
  assert.deepEqual(
    validateDesktopReleaseContract({ ...tagged, acknowledgeUnsignedWindows: true }),
    releaseMetadata("1.0.0"),
  );
});

test("rejects a mismatched tag and unavailable signing mode", () => {
  assert.throws(
    () =>
      validateDesktopReleaseContract({
        ...base,
        publishDraft: true,
        acknowledgeUnsignedWindows: true,
      }),
    /refs\/tags\/v1.0.0/,
  );
  assert.throws(() => validateDesktopReleaseContract({ ...base, signed: true }), /disabled/);
});
