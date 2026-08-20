import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const contractScript = resolve(repositoryRoot, "scripts/check-alpha-release-contract.mjs");
const releaseWorkflow = readFileSync(
  resolve(repositoryRoot, ".github/workflows/alpha-release.yml"),
  "utf8",
);
const reviewEnvironment = {
  RELEASE_VERSION: "0.1.0-alpha.1",
  PUBLISH_DRAFT: "false",
  SIGNED: "false",
  ACKNOWLEDGE_UNSIGNED_WINDOWS: "false",
  RELEASE_REF: "refs/heads/release/unsigned-alpha",
};

function runContract(overrides: Partial<typeof reviewEnvironment> = {}) {
  return spawnSync(process.execPath, [contractScript], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...reviewEnvironment, ...overrides },
  });
}

describe("Alpha release contract", () => {
  it("allows an unsigned review-only build without acknowledgement", () => {
    expect(runContract().status).toBe(0);
  });

  it("allows an explicitly acknowledged unsigned draft from the exact tag", () => {
    expect(runContract({
      PUBLISH_DRAFT: "true",
      ACKNOWLEDGE_UNSIGNED_WINDOWS: "true",
      RELEASE_REF: "refs/tags/v0.1.0-alpha.1",
    }).status).toBe(0);
  });

  it("rejects unsigned draft publication without acknowledgement", () => {
    const result = runContract({
      PUBLISH_DRAFT: "true",
      RELEASE_REF: "refs/tags/v0.1.0-alpha.1",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("requires explicit acknowledgement");
  });

  it("rejects draft publication from anything except the exact tag", () => {
    const result = runContract({
      PUBLISH_DRAFT: "true",
      ACKNOWLEDGE_UNSIGNED_WINDOWS: "true",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must run from refs/tags/v0.1.0-alpha.1");
  });

  it("keeps the unconfigured signed path fail-closed", () => {
    const result = runContract({ SIGNED: "true" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Signed Windows builds remain disabled");
  });

  it("rejects stable versions", () => {
    const result = runContract({ RELEASE_VERSION: "1.0.0" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Expected an alpha version");
  });

  it("binds draft publication to the exact commit that built the artifacts", () => {
    expect(releaseWorkflow).toContain('tag_ref="repos/${GITHUB_REPOSITORY}/git/ref/tags/v${RELEASE_VERSION}"');
    expect(releaseWorkflow).toContain('while [ "$tag_type" = "tag" ]');
    expect(releaseWorkflow).toContain('[ "$tag_sha" != "$GITHUB_SHA" ]');
  });
});
